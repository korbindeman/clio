// The admin's photo upload in real browsers (Chromium, WebKit, Firefox), with
// the files editors actually pick: a phone photo over 20 MB, a huge PNG and a
// transparent cut-out. Each upload goes through the browser half
// (admin/uploadImage.ts) and is then checked by the server half
// (readImageForm), so a browser quirk that makes an upload the server refuses
// fails here, not in production. Each browser also runs "without WebP": Safari
// cannot encode WebP from a canvas.
//
//   bun run test:browser                      # every installed browser
//   BROWSERS=chromium bun run test:browser    # one
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import sharp from "sharp";
import { chromium, firefox, webkit, type Browser, type BrowserType } from "playwright";
import { MAX_UPLOAD, readImageForm } from "../../src/upload.ts";

const ORIGIN = "http://clio.test";
const dir = mkdtempSync(join(tmpdir(), "clio-browser-"));
let bundle = "";
const fixtures: Record<string, string> = {};

before(async () => {
  writeFileSync(
    join(dir, "entry.ts"),
    `import { uploadImage } from ${JSON.stringify(new URL("../../src/admin/uploadImage.ts", import.meta.url).pathname)};\n(globalThis as any).uploadImage = uploadImage;\n`,
  );
  execFileSync("bun", ["build", join(dir, "entry.ts"), "--outfile", join(dir, "bundle.js"), "--target", "browser"], { stdio: "ignore" });
  bundle = readFileSync(join(dir, "bundle.js"), "utf8");
  const noise = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 60 } } });
  // A phone photo over 20 MB (more than the server keeps as it is).
  fixtures.photo = join(dir, "phone-photo.jpg");
  await noise(6000, 4500).jpeg({ quality: 100 }).toFile(fixtures.photo);
  // A huge PNG, far over every limit.
  fixtures.png = join(dir, "huge.png");
  await noise(7000, 5000).png({ compressionLevel: 1 }).toFile(fixtures.png);
  // A transparent cut-out: a detailed figure on a see-through background.
  const figure = await noise(1600, 2600).blur(1.2).png().toBuffer();
  fixtures.cutout = join(dir, "cutout.png");
  await sharp({ create: { width: 2400, height: 3400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: figure, left: 400, top: 400 }])
    .png()
    .toFile(fixtures.cutout);
});

after(() => rmSync(dir, { recursive: true, force: true }));

const engines: Record<string, BrowserType> = { chromium, webkit, firefox };
const wanted = (process.env.BROWSERS ?? "chromium,webkit,firefox").split(",").map((s) => s.trim());

for (const name of wanted) {
  const engine = engines[name];
  if (!engine) throw new Error(`Unknown browser ${name}`);
  describe(name, () => {
    let browser: Browser | undefined;
    before(async () => {
      try {
        browser = await engine.launch();
      } catch (error) {
        if (process.env.CI) throw error;
        console.warn(`${name} is not installed here; skipped.`);
      }
    });
    after(() => browser?.close());

    for (const webp of [true, false])
      for (const [fixture, alpha] of [["photo", false], ["png", false], ["cutout", true]] as const)
        test(`${fixture}${alpha ? " (cut-out)" : ""}${webp ? "" : ", without WebP encoding"}`, async (t) => {
          if (!browser) return t.skip(`${name} not installed`);
          const page = await browser.newPage();
          try {
            let received: { size: number; form: FormData } | undefined;
            await page.route(`${ORIGIN}/`, (r) =>
              r.fulfill({ contentType: "text/html", body: "<!doctype html><input type=file id=f>" }),
            );
            // Playwright leaves large file parts out of intercepted request bodies,
            // so the page hands the exact bytes it would send to the test instead.
            await page.exposeFunction("receiveUpload", async (base64: string, type: string) => {
              const body = Buffer.from(base64, "base64");
              const form = await new Request(`${ORIGIN}/upload`, {
                method: "POST",
                headers: { "Content-Type": type },
                body,
              }).formData();
              received = { size: body.length, form };
            });
            await page.addInitScript(() => {
              class FakeRequest {
                status = 0;
                responseText = "";
                timeout = 0;
                upload: { onprogress?: unknown } = {};
                onload?: () => void;
                onerror?: () => void;
                open() {}
                async send(body: FormData) {
                  const encoded = new Response(body);
                  const bytes = new Uint8Array(await encoded.arrayBuffer());
                  let binary = "";
                  for (let i = 0; i < bytes.length; i += 0x8000)
                    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
                  await (globalThis as any).receiveUpload(
                    btoa(binary),
                    encoded.headers.get("Content-Type"),
                  );
                  this.status = 200;
                  this.responseText = '{"ok":true}';
                  this.onload?.();
                }
              }
              (globalThis as any).XMLHttpRequest = FakeRequest;
            });
            await page.goto(`${ORIGIN}/`);
            if (!webp)
              await page.evaluate(() => {
                const toBlob = HTMLCanvasElement.prototype.toBlob;
                HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
                  return toBlob.call(this, callback, type === "image/webp" ? "image/png" : type, quality);
                };
              });
            await page.addScriptTag({ content: bundle });
            await page.setInputFiles("#f", fixtures[fixture]);
            const result = await page.evaluate(async (alpha) => {
              const file = (document.getElementById("f") as HTMLInputElement).files![0];
              try {
                return await (globalThis as any).uploadImage("/upload", file, 1, () => {}, {}, { alpha });
              } catch (error) {
                return { error: (error as Error).message };
              }
            }, alpha);
            assert.deepEqual(result, { ok: true });
            assert.ok(received, "nothing was uploaded");
            assert.ok(received.size <= MAX_UPLOAD, `upload is ${(received.size / 1048576).toFixed(1)} MB`);
            // The server half accepts exactly what the browser sent.
            const read = await readImageForm(received.form, "test");
            assert.ok(read.variants.length >= 1);
            if (alpha) {
              for (const object of read.objects.filter((o) => /\/\d+\.\w+$/.test(o.key))) {
                assert.match(object.type, /image\/(webp|png)/, `${object.key} lost its transparency`);
                const { channels } = await sharp(Buffer.from(await object.file.arrayBuffer())).stats();
                assert.ok(channels.length === 4 && channels[3].min === 0, `${object.key} is not see-through`);
              }
            }
          } finally {
            await page.close();
          }
        });
  });
}

import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { inspectImage, readLimited } from "../src/upload.ts";
import { imageSchema } from "../src/image.ts";
import { shareImage } from "../src/share.ts";
import { publishable, visibleItems } from "../src/store.ts";

test("uploads inspect image bytes instead of trusting content type or extension", async () => {
  const bytes = await sharp({
    create: { width: 20, height: 10, channels: 3, background: "red" },
  })
    .webp()
    .toBuffer();
  assert.equal(inspectImage(bytes, ["webp"]).width, 20);
  assert.throws(() =>
    inspectImage(
      new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
      ),
    ),
  );
  assert.throws(() => inspectImage(new Uint8Array([1, 2, 3])));
});
test("request limits also apply when no content length is supplied", async () => {
  const request = new Request("https://example.com", {
    method: "POST",
    body: "123456",
  });
  assert.equal(await readLimited(request, 5), null);
  assert.equal(
    new TextDecoder().decode(
      (await readLimited(
        new Request("https://example.com", { method: "POST", body: "123" }),
        5,
      ))!,
    ),
    "123",
  );
});
test("images reject arbitrary URLs", () => {
  const image = {
    id: "test",
    width: 20,
    height: 10,
    variants: [{ width: 20, src: "/media/test/20.webp" }],
    placeholder: "data:image/webp;base64,UklGRg==",
  };
  assert.equal(imageSchema.safeParse(image).success, true);
  assert.equal(
    imageSchema.safeParse({
      ...image,
      variants: [{ width: 20, src: "https://malicious.example/image" }],
    }).success,
    false,
  );
  assert.equal(imageSchema.safeParse({ ...image, id: "../x" }).success, false);
});
test("images reject placeholders that are not small WebP data URLs", () => {
  const image = {
    id: "test",
    width: 20,
    height: 10,
    variants: [{ width: 20, src: "/media/test/20.webp" }],
  };
  for (const placeholder of [
    "https://example.com/a.webp",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    `data:image/webp;base64,${"A".repeat(2001)}`,
    "",
  ])
    assert.equal(imageSchema.safeParse({ ...image, placeholder }).success, false);
});
test("link previews fit 1200px and never enlarge", () => {
  assert.deepEqual(shareImage("a", 6000, 4000), {
    src: "/media/a/share.jpg",
    width: 1200,
    height: 800,
  });
  assert.deepEqual(shareImage("a", 800, 1000), {
    src: "/media/a/share.jpg",
    width: 800,
    height: 1000,
  });
});
test("removed items are never part of the published snapshot", () => {
  assert.equal(
    visibleItems(
      JSON.stringify([
        { id: "a", removed: false },
        { id: "b", removed: true },
      ]),
    ),
    JSON.stringify([{ id: "a", removed: false }]),
  );
});
test("a document that is not a list is published as it is", () => {
  const home = JSON.stringify({ marquee: "Hi", removed: true });
  assert.equal(publishable(home), home);
});

test("display sizes may be JPEG, for browsers that cannot encode WebP (Safari)", async () => {
  const { readImageForm } = await import("../src/upload.ts");
  const make = (width: number, height: number, format: "jpeg" | "webp" | "png") =>
    sharp({ create: { width, height, channels: 3, background: "red" } })
      [format]()
      .toBuffer();
  const form = new FormData();
  form.append("original", new File([await make(400, 200, "png")], "o.png"));
  form.append("320", new File([await make(320, 160, "jpeg")], "320.jpg"));
  form.append("400", new File([await make(400, 200, "webp")], "400.webp"));
  const share = shareImage("x", 400, 200);
  form.append("share", new File([await make(share.width, share.height, "jpeg")], "share.jpg"));
  form.append("placeholder", "data:image/jpeg;base64,/9j/4AAQ");
  const read = await readImageForm(form, "abc");
  assert.deepEqual(
    read.variants.map((v) => v.src),
    ["/media/abc/320.jpg", "/media/abc/400.webp"],
  );
  assert.ok(read.objects.some((o) => o.key === "abc/320.jpg" && o.type === "image/jpeg"));
  const parsed = imageSchema.safeParse({
    id: "abc",
    width: 400,
    height: 200,
    variants: read.variants,
    placeholder: read.placeholder,
  });
  assert.ok(parsed.success);
});

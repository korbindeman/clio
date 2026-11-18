// Builds the production site as plain static files from a snapshot of WIP.
//
//   release                      export WIP (remote), build, verify
//   release -- --local <state>   use a local CMS state instead (CI)
//   release -- --snapshot <dir>  rebuild from an earlier export
//
// Output: release/snapshot (content.json and media) and release/site (the site).
// This never deploys.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { snapshotFromRows } from "../snapshot.js";
import { referencedMedia, verifyRelease } from "./verifyRelease.js";
export async function release(options) {
    const args = options.args ?? process.argv.slice(2);
    const option = (name) => {
        const index = args.indexOf(name);
        return index >= 0 ? args[index + 1] : undefined;
    };
    const localState = option("--local");
    const existing = option("--snapshot");
    const root = resolve("release");
    const snapshotDir = resolve(existing ?? join(root, "snapshot"));
    const siteDir = join(root, "site");
    // WIP is the preview environment. A local state uses the default bindings,
    // which the test fixture fills.
    const d1Flags = localState
        ? ["--local", "--persist-to", localState]
        : ["--env", "preview", "--remote"];
    const r2Flags = localState
        ? ["--local", "--persist-to", localState]
        : ["--remote"];
    const bucket = localState ? options.buckets.local : options.buckets.wip;
    const commandEnv = { ...process.env };
    delete commandEnv.CLOUDFLARE_ENV;
    const wrangler = (...command) => execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...command], { encoding: "utf8", env: commandEnv, stdio: ["ignore", "pipe", "inherit"] });
    async function exportContent() {
        const output = wrangler("d1", "execute", "CMS_DB", ...d1Flags, "--json", "--command", "SELECT id, published FROM cms_documents");
        const rows = JSON.parse(output)[0]?.results;
        if (!Array.isArray(rows))
            throw new Error("Could not read WIP's content.");
        const snapshot = snapshotFromRows(rows, options.documents, localState ? "local" : "wip");
        await rm(snapshotDir, { recursive: true, force: true });
        await mkdir(join(snapshotDir, "media"), { recursive: true });
        await writeFile(join(snapshotDir, "content.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
        const counts = Object.entries(snapshot.documents)
            .map(([id, value]) => Array.isArray(value) ? `${value.length} ${id}` : id)
            .join(", ");
        console.log(`Exported WIP's published content: ${counts}.`);
    }
    function build() {
        const env = {
            ...process.env,
            STATIC_RELEASE: "1",
            RELEASE_SNAPSHOT: snapshotDir,
            ...options.buildEnv,
        };
        delete env.CLOUDFLARE_ENV;
        // Media is copied next to the pages, so links stay on this domain.
        delete env.PUBLIC_MEDIA_ORIGIN;
        execFileSync(process.execPath, ["node_modules/astro/bin/astro.mjs", "build", "--outDir", siteDir], { stdio: "inherit", env });
    }
    // Fetch each referenced file once into the snapshot, then copy it into the site.
    async function copyMedia() {
        const keys = [...referencedMedia(siteDir)].sort();
        for (const key of keys) {
            const cached = join(snapshotDir, "media", key);
            if (!existsSync(cached)) {
                await mkdir(dirname(cached), { recursive: true });
                wrangler("r2", "object", "get", `${bucket}/${key}`, "--file", cached, ...r2Flags);
            }
            const target = join(siteDir, "media", key);
            await mkdir(dirname(target), { recursive: true });
            await copyFile(cached, target);
        }
        console.log(`Copied ${keys.length} media files.`);
    }
    if (!existing)
        await exportContent();
    else if (!existsSync(join(snapshotDir, "content.json")))
        throw new Error(`No content.json in ${snapshotDir}.`);
    await rm(siteDir, { recursive: true, force: true });
    build();
    await copyMedia();
    const problems = verifyRelease(siteDir, options.requiredPages);
    for (const problem of problems)
        console.error(problem);
    if (problems.length)
        process.exit(1);
    const { exportedAt } = JSON.parse(await readFile(join(snapshotDir, "content.json"), "utf8"));
    console.log(`Static release ready in ${siteDir} (content exported ${exportedAt}). Nothing was deployed.`);
}

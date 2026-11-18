// Compiles src/ to dist/ and copies the Svelte components beside the output.
// dist/ is committed, so sites can install the package straight from Git.
// --check fails when the committed dist/ differs from a fresh build.
import { execFileSync } from "node:child_process";
import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const check = process.argv.includes("--check");
if (check) {
  const changed = execFileSync("git", ["status", "--porcelain", "--", "dist"], {
    encoding: "utf8",
  }).trim();
  if (changed) {
    console.error(`dist/ is out of date. Run bun run build and commit it.\n${changed}`);
    process.exit(1);
  }
  process.exit(0);
}

rmSync("dist", { recursive: true, force: true });
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], {
  stdio: "inherit",
});
const copy = (dir) => {
  for (const entry of readdirSync(join("src", dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) copy(path);
    else if (/\.(svelte|css)$/.test(entry.name)) cpSync(join("src", path), join("dist", path));
  }
};
copy("");
// TypeScript rewrites static imports of ./x.ts to ./x.js, but not dynamic ones.
const rewrite = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) rewrite(path);
    else if (entry.name.endsWith(".js")) {
      const text = readFileSync(path, "utf8");
      const next = text.replace(/import\((["'])(\.{1,2}\/[^"']+)\.ts\1\)/g, "import($1$2.js$1)");
      if (next !== text) writeFileSync(path, next);
    }
  }
};
rewrite("dist");
// Type declarations for the Svelte components, so sites type-check their props.
const { emitDts } = await import("svelte2tsx");
const { createRequire } = await import("node:module");
rmSync(".svelte-types", { recursive: true, force: true });
await emitDts({
  libRoot: "src",
  tsconfig: join(process.cwd(), "tsconfig.json"),
  declarationDir: ".svelte-types",
  svelteShimsPath: createRequire(import.meta.url).resolve("svelte2tsx/svelte-shims-v4.d.ts"),
});
for (const name of readdirSync(".svelte-types/admin"))
  if (name.endsWith(".svelte.d.ts"))
    cpSync(join(".svelte-types/admin", name), join("dist/admin", name));
rmSync(".svelte-types", { recursive: true, force: true });
console.log("Built dist/.");

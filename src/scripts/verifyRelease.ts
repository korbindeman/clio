// Checks a static release before it can ship: plain files only, no admin, auth
// or CMS routes, and every media file a page refers to is present.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { mediaKeysIn } from "../image.ts";

export { mediaKeysIn };
// Cloudflare static assets reject files above 25 MiB.
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const TEXT = /\.(html|xml|txt|js|mjs|css|json|webmanifest|svg)$/;
const FORBIDDEN = [
  /^admin(\/|$)/,
  /^api(\/|$)/,
  /^login(\/|\.html$|$)/,
  /^logout(\/|\.html$|$)/,
  /^_worker\.js/,
  /^_routes\.json$/,
  /^server(\/|$)/,
  /^wrangler\.json$/,
];

export function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

// Media keys referenced anywhere in the built text files.
export function referencedMedia(dir: string) {
  const keys = new Set<string>();
  for (const file of listFiles(dir))
    if (TEXT.test(file))
      for (const key of mediaKeysIn(readFileSync(file, "utf8"))) keys.add(key);
  return keys;
}

export function verifyRelease(dir: string, requiredPages: string[]) {
  const problems: string[] = [];
  const files = listFiles(dir).map((file) =>
    relative(dir, file).split(sep).join("/"),
  );
  const present = new Set(files);
  for (const file of files) {
    if (FORBIDDEN.some((pattern) => pattern.test(file)))
      problems.push(`Not allowed in a static release: ${file}`);
    if (statSync(join(dir, file)).size > MAX_ASSET_BYTES)
      problems.push(`Larger than 25 MiB: ${file}`);
    if (TEXT.test(file)) {
      const text = readFileSync(join(dir, file), "utf8");
      if (/["'(]\/(?:api\/|admin\/|login\/)/.test(text))
        problems.push(`Links to an admin or API route: ${file}`);
    }
  }
  for (const page of requiredPages)
    if (!present.has(page)) problems.push(`Missing page: ${page}`);
  for (const key of referencedMedia(dir))
    if (!present.has(`media/${key}`)) problems.push(`Missing media: ${key}`);
  return problems;
}

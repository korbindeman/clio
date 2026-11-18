import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { cmsRoutes } from "../src/integration.ts";
import { mediaKeysIn, verifyRelease } from "../src/scripts/verifyRelease.ts";
import { parseSnapshot, snapshotFromRows } from "../src/snapshot.ts";

const kinds = {
  photographs: "list",
  films: "list",
  sources: "list",
  home: "object",
} as const;
const REQUIRED_PAGES = ["index.html", "404.html"];

test("a snapshot takes WIP's published content, not its drafts", () => {
  const snapshot = snapshotFromRows(
    [
      { id: "photographs", published: '[{"id":"a"}]' },
      { id: "sources", published: null },
      { id: "films", published: "[]" },
      { id: "home", published: '{"marquee":"Hi"}' },
    ],
    kinds,
    "wip",
    "2026-10-15T00:00:00.000Z",
  );
  assert.deepEqual(snapshot.documents, {
    photographs: [{ id: "a" }],
    films: [],
    sources: [],
    home: { marquee: "Hi" },
  });
  assert.equal(
    parseSnapshot(JSON.parse(JSON.stringify(snapshot)), kinds).source,
    "wip",
  );
  assert.throws(() => parseSnapshot({ version: 2 }, kinds));
  assert.throws(
    () => parseSnapshot({ ...snapshot, documents: { photographs: [] } }, kinds),
    /has no films/,
  );
  assert.throws(
    () => snapshotFromRows([{ id: "films", published: "{}" }], kinds, "wip"),
    /films is not a list/,
  );
  assert.throws(
    () => snapshotFromRows([{ id: "home", published: "[]" }], kinds, "wip"),
    /home is not an object/,
  );
  assert.deepEqual(snapshotFromRows([], kinds, "wip").documents.home, {});
});

test("media references are found in built pages", () => {
  const keys = mediaKeysIn(
    '<img srcset="/media/abc-1/320.webp 320w, /media/abc-1/640.webp 640w"><video data-src="/media/loop/clip.mp4"> /media/x/secret.txt',
  );
  assert.deepEqual([...keys].sort(), [
    "abc-1/320.webp",
    "abc-1/640.webp",
    "loop/clip.mp4",
  ]);
});

function site(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "cms-release-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}
const pages = Object.fromEntries(
  REQUIRED_PAGES.map((page) => [page, "<html></html>"]),
);

test("a complete static release passes verification", () => {
  const dir = site({
    ...pages,
    "index.html": '<img src="/media/a/320.webp">',
    "media/a/320.webp": "x",
  });
  try {
    assert.deepEqual(verifyRelease(dir, REQUIRED_PAGES), []);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("admin, auth, API, Worker files and missing media fail verification", () => {
  const dir = site({
    ...pages,
    "index.html": '<a href="/admin/">Admin</a><img src="/media/a/320.webp">',
    "admin/index.html": "",
    "login/index.html": "",
    "api/admin/sources": "",
    "_worker.js/index.js": "",
  });
  try {
    const problems = verifyRelease(dir, REQUIRED_PAGES).join("\n");
    assert.match(
      problems,
      /Not allowed in a static release: admin\/index.html/,
    );
    assert.match(
      problems,
      /Not allowed in a static release: login\/index.html/,
    );
    assert.match(
      problems,
      /Not allowed in a static release: api\/admin\/sources/,
    );
    assert.match(problems, /Not allowed in a static release: _worker.js/);
    assert.match(problems, /Links to an admin or API route: index.html/);
    assert.match(problems, /Missing media: a\/320.webp/);
  } finally {
    rmSync(dir, { recursive: true });
  }
  const empty = site({});
  try {
    assert.match(verifyRelease(empty, REQUIRED_PAGES).join("\n"), /Missing page: index.html/);
  } finally {
    rmSync(empty, { recursive: true });
  }
});

test("core routes come first, then the site's own pages", () => {
  const root = mkdtempSync(join(tmpdir(), "cms-routes-"));
  try {
    for (const path of [
      "src/cms/pages/admin/index.astro",
      "src/cms/pages/admin/home/preview.astro",
      "src/cms/pages/api/admin/home.ts",
      "src/cms/pages/login.astro",
      "src/cms/pages/notes.md",
    ]) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), "");
    }
    const routes = cmsRoutes("src/cms/pages", root);
    const patterns = routes.map((route) => route.pattern);
    for (const pattern of [
      "/admin",
      "/admin/home/preview",
      "/api/admin/home",
      "/api/auth/[...path]",
      "/login",
      "/logout",
      "/media/[...key]",
    ])
      assert.ok(patterns.includes(pattern), pattern);
    assert.equal(patterns.length, 7);
    assert.equal(
      routes.find((route) => route.pattern === "/admin")!.entrypoint,
      "./src/cms/pages/admin/index.astro",
    );
    assert.match(
      routes.find((route) => route.pattern === "/logout")!.entrypoint,
      /^@korbindeman\/clio\/routes\//,
    );
    assert.equal(cmsRoutes(undefined, root).length, 3);
  } finally {
    rmSync(root, { recursive: true });
  }
});

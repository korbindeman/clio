import assert from "node:assert/strict";
import { test } from "node:test";
import {
  serialiseBindings,
  serialiseD1,
  withSerialisedAdmin,
} from "../src/serialD1.ts";
import { d1Busy, d1Retry, saveDraft } from "../src/store.ts";

test("d1Busy recognises lock errors from local SQLite and D1", () => {
  assert.equal(
    d1Busy(new Error("D1_ERROR: SQLITE_BUSY: database is locked")),
    true,
  );
  assert.equal(
    d1Busy(new Error("This database connection is busy executing a query")),
    true,
  );
  assert.equal(d1Busy(new Error("no such table")), false);
  assert.equal(
    d1Busy(
      new Error("write failed", {
        cause: new Error("SQLITE_LOCKED: database table is locked"),
      }),
    ),
    true,
  );
});

test("d1Retry does not wait out a lock", async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      d1Retry(async () => {
        attempts += 1;
        throw new Error("D1_ERROR: SQLITE_BUSY: database is locked");
      }),
    /SQLITE_BUSY/,
  );
  assert.equal(attempts, 1);
});

test("admin requests run one at a time", async () => {
  const order: string[] = [];
  await Promise.all(
    [1, 2].map((n) =>
      withSerialisedAdmin(async () => {
        order.push(`start${n}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push(`end${n}`);
      }),
    ),
  );
  assert.deepEqual(order, ["start1", "end1", "start2", "end2"]);
});

test("serialiseBindings keeps the queued database on env", async () => {
  const order: string[] = [];
  const fake = {
    prepare() {
      return {
        bind() {
          return this;
        },
        async run() {
          order.push("run");
          return { success: true, meta: { changes: 1 } };
        },
        first: async () => null,
        all: async () => ({ results: [] }),
        raw: async () => [],
      };
    },
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
  } as unknown as D1Database;
  const originalPrepare = fake.prepare;
  const env = { CMS_DB: fake };
  serialiseBindings(env);
  await env.CMS_DB.prepare("a").run();
  assert.deepEqual(order, ["run"]);
  assert.notEqual(env.CMS_DB.prepare, originalPrepare);
});

test("serial D1 runs overlapping statements one at a time", async () => {
  const order: string[] = [];
  let current = 0;
  const fake = {
    prepare() {
      return {
        bind() {
          return this;
        },
        async run() {
          const n = ++current;
          order.push(`start${n}`);
          await new Promise((resolve) => setTimeout(resolve, 20));
          order.push(`end${n}`);
          return { success: true, meta: { changes: 1 } };
        },
        first: async () => null,
        all: async () => ({ results: [] }),
        raw: async () => [],
      };
    },
    async batch() {
      return [];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
  } as unknown as D1Database;
  const db = serialiseD1(fake);
  await Promise.all([db.prepare("a").run(), db.prepare("b").run()]);
  assert.deepEqual(order, ["start1", "end1", "start2", "end2"]);
});

const row = (revision: number) => ({
  draft: "[]",
  published: "[]",
  revision,
  published_at: null,
});

test("a busy stale draft write is a conflict, not a 500", async () => {
  const db = {
    prepare() {
      return {
        bind() {
          return this;
        },
        async run() {
          throw new Error("D1_ERROR: SQLITE_BUSY: database is locked");
        },
        async first() {
          return row(3);
        },
        all: async () => ({ results: [] }),
        raw: async () => [],
      };
    },
  } as unknown as D1Database;
  assert.equal(await saveDraft(db, "films", 2, [], "a"), null);
});

test("a busy current draft write is still an error", async () => {
  const db = {
    prepare() {
      return {
        bind() {
          return this;
        },
        async run() {
          throw new Error("D1_ERROR: SQLITE_BUSY: database is locked");
        },
        async first() {
          return row(3);
        },
        all: async () => ({ results: [] }),
        raw: async () => [],
      };
    },
  } as unknown as D1Database;
  await assert.rejects(
    () => saveDraft(db, "films", 3, [], "a"),
    /SQLITE_BUSY/,
  );
});

// A D1-shaped wrapper over node:sqlite, enough for the store.
async function sqliteD1() {
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync } = await import("node:fs");
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    readFileSync(new URL("../migrations/0001_cms.sql", import.meta.url), "utf8"),
  );
  const statement = (query: string, values: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(query, next),
    first: async () => sqlite.prepare(query).get(...(values as [])) ?? null,
    all: async () => ({ results: sqlite.prepare(query).all(...(values as [])) }),
    run: async () => ({
      meta: { changes: Number(sqlite.prepare(query).run(...(values as [])).changes) },
    }),
  });
  return { db: { prepare: (query: string) => statement(query) } as unknown as D1Database, sqlite };
}

test("drafts save, publish and keep history behind a revision check", async () => {
  const { initializeDocuments, readRow, publishDocument, readPublishedJson, documentMeta } =
    await import("../src/store.ts");
  const { db, sqlite } = await sqliteD1();
  await initializeDocuments(db, { home: { marquee: "Hi" }, garments: [] }, "a");
  await initializeDocuments(db, { home: { marquee: "Ignored" } }, "a");
  const first = (await readRow(db, "home"))!;
  assert.equal(first.revision, 1);
  assert.deepEqual(await readPublishedJson(db, "home", {}), { marquee: "Hi" });
  assert.equal(documentMeta(first).hasChanges, false);

  const saved = (await saveDraft(db, "home", 1, { marquee: "New" }, "a"))!;
  assert.equal(saved.revision, 2);
  assert.equal(documentMeta(saved).hasChanges, true);
  assert.equal(await saveDraft(db, "home", 1, { marquee: "Stale" }, "a"), null);
  assert.equal(await publishDocument(db, "home", 1, "a"), null);
  // Publishing does not move the revision, so the editor can keep saving.
  let before = "";
  const published = (await publishDocument(db, "home", 2, "a", async (row) => {
    before = row.published!;
  }))!;
  assert.equal(published.revision, 2);
  assert.equal(before, '{"marquee":"Hi"}');
  assert.deepEqual(await readPublishedJson(db, "home", {}), { marquee: "New" });
  assert.deepEqual(await readPublishedJson(db, "missing", {}), {});
  const history = sqlite
    .prepare("SELECT revision FROM cms_history WHERE document_id = 'home' ORDER BY id")
    .all();
  assert.deepEqual(history.map((row) => row.revision), [1, 2]);
});

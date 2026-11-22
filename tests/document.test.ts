// EditableDocument (admin/document.svelte.ts): autosave and flush. The class
// uses Svelte runes, so the test compiles it with Svelte first and runs it
// against a fake fetch.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { compileModule } from "svelte/compiler";
import ts from "typescript";

// Inside the package, so "svelte/internal/client" resolves.
const dir = mkdtempSync(join(import.meta.dirname, ".document-"));
let EditableDocument: any;

before(async () => {
  const source = readFileSync(new URL("../src/admin/document.svelte.ts", import.meta.url), "utf8")
    .replace(/^import \{ uploadImage \}.*$/m, "const uploadImage = undefined;");
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const file = join(dir, "document.svelte.js");
  writeFileSync(file, compileModule(js, { filename: file, generate: "client" }).js.code);
  ({ EditableDocument } = await import(file));
});
after(() => rmSync(dir, { recursive: true, force: true }));

// A server that keeps one draft, fails the next `failures` saves and takes
// `delay` ms to answer a save.
function server(failures = 0, delay = 0) {
  const state = { draft: { title: "a" }, revision: 1, puts: 0 };
  globalThis.fetch = (async (_path: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      state.puts++;
      await wait(delay);
      if (failures > 0) {
        failures--;
        return new Response(JSON.stringify({ error: "Offline" }), { status: 503 });
      }
      const body = JSON.parse(String(init.body));
      state.draft = body.draft;
      state.revision++;
    }
    return Response.json({ draft: state.draft, revision: state.revision, publishedAt: null, hasChanges: true });
  }) as typeof fetch;
  return state;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("flush saves a pending change right away", async () => {
  const state = server();
  const doc = new EditableDocument("page", "/api/admin/page");
  await doc.load();
  doc.change((d: any) => (d.title = "b"), 10_000);
  await doc.flush();
  assert.equal(state.draft.title, "b");
  assert.equal(doc.saveState, "saved");
  assert.equal(doc.dirty, false);
});

test("after a failed flush, later autosaves still save", async () => {
  const state = server(1);
  const doc = new EditableDocument("page", "/api/admin/page");
  await doc.load();
  doc.change((d: any) => (d.title = "b"), 10_000);
  await assert.rejects(doc.flush(), /Offline/);
  assert.equal(doc.saveState, "error");
  assert.equal(doc.error, "Offline");

  doc.change((d: any) => (d.title = "c"), 0);
  await wait(20);
  await doc.flush();
  assert.equal(state.draft.title, "c");
  assert.equal(doc.saveState, "saved");
  assert.equal(doc.error, "");

  doc.change((d: any) => (d.title = "d"), 10_000);
  await doc.flush();
  assert.equal(state.draft.title, "d");
  assert.equal(state.puts, 3);
});

test("a change made while a save is on its way is kept and saved next", async () => {
  const state = server(0, 50);
  const doc = new EditableDocument("page", "/api/admin/page");
  await doc.load();
  doc.change((d: any) => (d.title = "b"), 10_000);
  const first = doc.flush();
  await wait(10); // "b" is on its way
  doc.undo(); // back to "a" before the server answers
  const second = doc.flush();
  await first;
  assert.equal(doc.draft.title, "a", "the undo is not overwritten by the answer");
  await second;
  assert.equal(state.draft.title, "a");
  assert.equal(doc.dirty, false);
  assert.equal(doc.saveState, "saved");
});

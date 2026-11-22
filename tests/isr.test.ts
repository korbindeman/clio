import assert from "node:assert/strict";
import { test } from "node:test";
import { isrCacheKey, isrMatch, isrResponse, type IsrCache } from "../src/isr.ts";

function memoryCache(): IsrCache & { store: Map<string, Response> } {
  const store = new Map<string, Response>();
  return {
    store,
    async match(key) {
      return store.get(key)?.clone();
    },
    async put(key, response) {
      store.set(key, response);
    },
  };
}

test("isrMatch matches exact pages and wildcard sections, ignoring trailing slashes", () => {
  const patterns = ["/", "/archive/garments", "/collections/*"];
  assert.equal(isrMatch("/", patterns), true);
  assert.equal(isrMatch("/archive/garments/", patterns), true);
  assert.equal(isrMatch("/archive/garments/x", patterns), false);
  assert.equal(isrMatch("/collections/ss26/", patterns), true);
  assert.equal(isrMatch("/collections", patterns), true);
  assert.equal(isrMatch("/collectionsx", patterns), false);
  assert.equal(isrMatch("/admin/", patterns), false);
});

test("the cache key carries the content version and drops the query", () => {
  const key = isrCacheKey(new URL("https://site.example/a/?x=1"), "2026-11-18T17:00:00Z");
  assert.equal(key, "https://site.example/a/?__clio=2026-11-18T17%3A00%3A00Z");
});

test("a page renders once per publication and is then served from cache", async () => {
  const cache = memoryCache();
  let renders = 0;
  let version = "v1";
  const render = async () => {
    renders += 1;
    return new Response(`page ${renders}`, { headers: { "Content-Type": "text/html" } });
  };
  const request = () => new Request("https://site.example/");
  const first = await isrResponse(request(), async () => version, cache, render);
  assert.equal(await first.text(), "page 1");
  assert.equal(first.headers.get("X-Clio-Cache"), "miss");
  const second = await isrResponse(request(), async () => version, cache, render);
  assert.equal(await second.text(), "page 1");
  assert.equal(second.headers.get("X-Clio-Cache"), "hit");
  assert.match(second.headers.get("Cache-Control") ?? "", /max-age=0/);
  version = "v2";
  const third = await isrResponse(request(), async () => version, cache, render);
  assert.equal(await third.text(), "page 2");
  assert.equal(renders, 2);
});

test("private, cookie-setting, failed and query requests are never cached", async () => {
  const cases: [Request, Response][] = [
    [new Request("https://site.example/"), new Response("x", { headers: { "Set-Cookie": "a=b" } })],
    [new Request("https://site.example/"), new Response("x", { headers: { "Cache-Control": "private, no-store" } })],
    [new Request("https://site.example/"), new Response("x", { status: 500 })],
    [new Request("https://site.example/?preview=1"), new Response("x")],
    [new Request("https://site.example/", { method: "POST" }), new Response("x")],
  ];
  for (const [request, response] of cases) {
    const cache = memoryCache();
    await isrResponse(request, async () => "v1", cache, async () => response.clone());
    assert.equal(cache.store.size, 0, `${request.method} ${request.url}`);
  }
});

test("without an edge cache or when the version read fails, pages still render", async () => {
  const ok = async () => new Response("fresh");
  assert.equal(await (await isrResponse(new Request("https://site.example/"), async () => "v", undefined, ok)).text(), "fresh");
  const failing = async () => {
    throw new Error("D1 down");
  };
  assert.equal(await (await isrResponse(new Request("https://site.example/"), failing, memoryCache(), ok)).text(), "fresh");
});

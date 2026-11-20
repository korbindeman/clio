// Incremental static regeneration for a live site (no WIP, no static release).
//
// A page listed in the `isr` option is rendered once and kept in the
// Cloudflare edge cache. The cache key carries the build id and the time of
// the latest publication, so a deploy or publishing any document changes the
// key: the next visit renders the page again and every visit after that is
// served from cache. (Without the build id, a page cached before a deploy
// would point at script files the deploy removed.)
// Old entries are never read again and expire on their own.

// "/archive/garments" matches that page; "/collections/*" matches every page
// under /collections/. Trailing slashes are ignored.
export function isrMatch(path: string, patterns: readonly string[]): boolean {
  const clean = (value: string) => value.replace(/\/+$/, "") || "/";
  const target = clean(path);
  return patterns.some((pattern) => {
    if (pattern.endsWith("/*")) {
      const base = clean(pattern.slice(0, -2));
      return target === base || target.startsWith(base === "/" ? "/" : `${base}/`);
    }
    return target === clean(pattern);
  });
}

// The key ignores the query string (requests with one bypass the cache) and
// carries the content version, so a publication starts a fresh set of entries.
export function isrCacheKey(url: URL, version: string): string {
  return `${url.origin}${url.pathname}?__clio=${encodeURIComponent(version)}`;
}

export interface IsrCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}

// Browsers and shared caches always come back to the Worker, which answers
// from the edge cache. That keeps a publication visible at once.
const BROWSER_CACHE = "public, max-age=0, must-revalidate";
// How long an edge entry may live. The version in the key, not this, is what
// makes a publication show.
const EDGE_CACHE = "public, max-age=31536000";

export async function isrResponse(
  request: Request,
  version: () => Promise<string>,
  cache: IsrCache | undefined,
  render: () => Promise<Response>,
): Promise<Response> {
  const url = new URL(request.url);
  if (!cache || !["GET", "HEAD"].includes(request.method) || url.search)
    return render();
  let key: string;
  try {
    key = isrCacheKey(url, await version());
  } catch {
    return render();
  }
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) {
    const response = new Response(request.method === "HEAD" ? null : hit.body, hit);
    response.headers.set("Cache-Control", BROWSER_CACHE);
    response.headers.set("X-Clio-Cache", "hit");
    return response;
  }
  const response = await render();
  // Only plain successful pages are shared: never one that sets a cookie or
  // says it is private.
  const cacheable =
    request.method === "GET" &&
    response.status === 200 &&
    !response.headers.has("Set-Cookie") &&
    !/private|no-store/i.test(response.headers.get("Cache-Control") ?? "");
  if (!cacheable) return response;
  const body = await response.arrayBuffer();
  const stored = new Response(body, response);
  stored.headers.set("Cache-Control", EDGE_CACHE);
  await cache.put(key, stored).catch(() => {});
  const fresh = new Response(body, response);
  fresh.headers.set("Cache-Control", BROWSER_CACHE);
  fresh.headers.set("X-Clio-Cache", "miss");
  return fresh;
}

// The latest publication time across all documents: one small D1 read.
export async function contentVersion(db: D1Database): Promise<string> {
  const row = await db
    .prepare("SELECT MAX(published_at) AS version FROM cms_documents")
    .first<{ version: string | null }>();
  return row?.version ?? "none";
}

// The Workers edge cache, where it exists (not in Node or in tests).
export function edgeCache(): IsrCache | undefined {
  const caches = (globalThis as { caches?: { default?: IsrCache } }).caches;
  return caches?.default;
}

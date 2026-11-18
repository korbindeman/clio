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
export function isrMatch(path, patterns) {
    const clean = (value) => value.replace(/\/+$/, "") || "/";
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
export function isrCacheKey(url, version) {
    return `${url.origin}${url.pathname}?__clio=${encodeURIComponent(version)}`;
}
// Browsers and shared caches always come back to the Worker, which answers
// from the edge cache. That keeps a publication visible at once.
const BROWSER_CACHE = "public, max-age=0, must-revalidate";
// How long an edge entry may live. The version in the key, not this, is what
// makes a publication show.
const EDGE_CACHE = "public, max-age=31536000";
export async function isrResponse(request, version, cache, render) {
    const url = new URL(request.url);
    if (!cache || !["GET", "HEAD"].includes(request.method) || url.search)
        return render();
    let key;
    try {
        key = isrCacheKey(url, await version());
    }
    catch {
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
    const cacheable = request.method === "GET" &&
        response.status === 200 &&
        !response.headers.has("Set-Cookie") &&
        !/private|no-store/i.test(response.headers.get("Cache-Control") ?? "");
    if (!cacheable)
        return response;
    const body = await response.arrayBuffer();
    const stored = new Response(body, response);
    stored.headers.set("Cache-Control", EDGE_CACHE);
    await cache.put(key, stored).catch(() => { });
    const fresh = new Response(body, response);
    fresh.headers.set("Cache-Control", BROWSER_CACHE);
    fresh.headers.set("X-Clio-Cache", "miss");
    return fresh;
}
// The latest publication time across all documents: one small D1 read.
export async function contentVersion(db) {
    const row = await db
        .prepare("SELECT MAX(published_at) AS version FROM cms_documents")
        .first();
    return row?.version ?? "none";
}
// The Workers edge cache, where it exists (not in Node or in tests).
export function edgeCache() {
    const caches = globalThis.caches;
    return caches?.default;
}

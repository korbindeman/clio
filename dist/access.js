// WIP HTML and media must pass this gate before Cloudflare serves static assets.
export function publicPreviewPath(path) {
    return (path === "/login" ||
        path === "/login/" ||
        path === "/logout" ||
        path === "/logout/" ||
        path.startsWith("/api/auth/") ||
        path === "/favicon.svg" ||
        // Contains only deployment IDs, used by the publisher to confirm a release.
        path === "/publication.json" ||
        /^\/_astro\/[^/]+\.(?:js|css|woff2)$/.test(path));
}
export function loginDestination(value, fallback = "/admin/") {
    if (!value ||
        !value.startsWith("/") ||
        value.startsWith("//") ||
        /[\\\r\n]/.test(value))
        return fallback;
    const url = new URL(value, "https://local.invalid");
    if (url.origin !== "https://local.invalid" ||
        /^\/(?:login|logout|api)(?:\/|$)/.test(url.pathname))
        return fallback;
    return url.pathname + url.search + url.hash;
}
export async function previewResponse(request, authenticate, next) {
    const url = new URL(request.url);
    const headers = {
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "X-Content-Type-Options": "nosniff",
    };
    if (!publicPreviewPath(url.pathname)) {
        let email;
        try {
            email = await authenticate();
        }
        catch {
            console.error(JSON.stringify({ event: "preview_session_error", path: url.pathname }));
            return new Response("Sign-in is unavailable. Please try again later.", {
                status: 503,
                headers,
            });
        }
        if (!email) {
            if (["GET", "HEAD"].includes(request.method) &&
                request.headers.get("Accept")?.includes("text/html")) {
                return new Response(null, {
                    status: 302,
                    headers: {
                        ...headers,
                        Location: `/login/?next=${encodeURIComponent(url.pathname + url.search)}`,
                    },
                });
            }
            return new Response("Sign in to view this preview.", {
                status: 401,
                headers,
            });
        }
    }
    const original = await next();
    const response = new Response(original.body, original);
    for (const [name, value] of Object.entries(headers))
        response.headers.set(name, value);
    return response;
}

import { defineMiddleware } from "astro:middleware";
import config from "virtual:clio/config";
import { isrMatch } from "./isr.js";
// Guards the admin pages and the admin API: a signed-in editor, and for
// writes, a request from the site itself. Public pages listed in the `isr`
// option are served from the edge cache until the next publication. The integration adds this outside a
// static release only, since a release has no admin or CMS API.
export const onRequest = defineMiddleware(async (context, next) => {
    const path = context.url.pathname;
    const protectedRoute = /^\/admin(?:\/|$)/.test(path) || /^\/api\/admin(?:\/|$)/.test(path);
    if (!protectedRoute) {
        if (!config.isr?.length || !isrMatch(path, config.isr))
            return next();
        const [{ isrResponse, contentVersion, edgeCache }, { cmsEnv }] = await Promise.all([import("./isr.js"), import("./login.js")]);
        return isrResponse(context.request, () => contentVersion(cmsEnv().CMS_DB), edgeCache(), next);
    }
    const { withSerialisedAdmin } = await import("./serialD1.js");
    return withSerialisedAdmin(() => handleAdmin(context, next));
});
// Returning 403/401 without reading a PUT body aborts Miniflare's request
// stream and kills workerd. The next admin write then surfaces as 500.
async function reject(request, response) {
    if (!["GET", "HEAD"].includes(request.method) && request.body)
        try {
            await request.arrayBuffer();
        }
        catch {
            /* already consumed or aborted */
        }
    return response;
}
async function handleAdmin(context, next) {
    const path = context.url.pathname;
    const { authenticate, sameOrigin } = await import("./auth.js");
    const { loginAuth, cmsEnv } = await import("./login.js");
    const env = cmsEnv();
    const { serialiseBindings } = await import("./serialD1.js");
    serialiseBindings(env);
    const headers = {
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "X-Content-Type-Options": "nosniff",
    };
    let email;
    try {
        email = await authenticate(context.request, loginAuth(context.request), env.ADMIN_EMAILS);
    }
    catch {
        console.error(JSON.stringify({ event: "login_session_error", path }));
        return reject(context.request, Response.json({ error: "Sign-in is unavailable. Please try again later." }, { status: 503, headers }));
    }
    if (!email) {
        if (path.startsWith("/admin") &&
            ["GET", "HEAD"].includes(context.request.method)) {
            return new Response(null, {
                status: 302,
                headers: { ...headers, Location: "/login/" },
            });
        }
        return reject(context.request, Response.json({ error: "Your session has expired. Sign in again, then retry." }, { status: 401, headers }));
    }
    context.locals.adminEmail = email;
    if (!["GET", "HEAD"].includes(context.request.method) &&
        !sameOrigin(context.request))
        return reject(context.request, new Response("This request must come from the admin site.", {
            status: 403,
            headers,
        }));
    try {
        const response = await next();
        for (const [key, value] of Object.entries(headers))
            response.headers.set(key, value);
        response.headers.set("Content-Security-Policy", "frame-ancestors 'self'");
        return response;
    }
    catch (error) {
        const id = crypto.randomUUID();
        console.error(JSON.stringify({
            event: "cms_error",
            requestId: id,
            path,
            error: error instanceof Error ? error.message : "Unknown error",
        }));
        return reject(context.request, Response.json({ error: `The request failed. Please try again. Reference: ${id}` }, { status: 500, headers }));
    }
}

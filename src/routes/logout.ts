import type { APIRoute } from "astro";
import { sameOrigin } from "../auth.ts";
import { loginAuth } from "../login.ts";
export const prerender = false;
export const POST: APIRoute = async ({ request }) => {
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  if (!sameOrigin(request))
    return new Response("This request must come from the site.", {
      status: 403,
      headers,
    });
  try {
    const response = await loginAuth(request).api.signOut({
      headers: request.headers,
      asResponse: true,
    });
    if (!response.ok)
      return new Response("Sign-out failed. Please try again.", {
        status: 503,
        headers,
      });
    for (const cookie of response.headers.getSetCookie())
      headers.append("Set-Cookie", cookie);
    headers.set("Location", "/login/");
    return new Response(null, { status: 303, headers });
  } catch {
    console.error(JSON.stringify({ event: "login_signout_failed" }));
    return new Response("Sign-out failed. Please try again.", {
      status: 503,
      headers,
    });
  }
};

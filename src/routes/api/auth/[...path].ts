import type { APIRoute } from "astro";
import { sameOrigin } from "../../../auth.ts";
import { readLimited } from "../../../upload.ts";
import { loginAuth } from "../../../login.ts";
export const prerender = false;

const endpoints = new Map([
  ["sign-in/magic-link", "POST"],
  ["magic-link/verify", "GET"],
  ["sign-in/email-otp", "POST"],
  ["sign-in/email", "POST"],
  ["sign-out", "POST"],
  ["get-session", "GET"],
]);
export const ALL: APIRoute = async ({ request, params }) => {
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  };
  if (endpoints.get(params.path ?? "") !== request.method)
    return new Response(null, { status: 404, headers });
  if (request.method === "POST" && !sameOrigin(request))
    return Response.json(
      { message: "This request must come from the sign-in page." },
      { status: 403, headers },
    );
  try {
    let authRequest = request;
    if (request.method === "POST") {
      const body = await readLimited(request, 4096);
      if (!body)
        return Response.json(
          { message: "The request is too large." },
          { status: 413, headers },
        );
      authRequest = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body,
      });
    }
    const response = await loginAuth(authRequest).handler(authRequest);
    for (const [name, value] of Object.entries(headers))
      response.headers.set(name, value);
    return response;
  } catch {
    const reference = crypto.randomUUID();
    console.error(JSON.stringify({ event: "login_error", reference }));
    return Response.json(
      { message: "Sign-in is unavailable. Please try again later.", reference },
      { status: 503, headers },
    );
  }
};

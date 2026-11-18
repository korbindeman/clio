import type { APIRoute } from "astro";
import { allowedAdmin } from "../auth.ts";
import { cmsEnv, localLinks, loginAuth } from "../login.ts";
import { serialiseD1 } from "../serialD1.ts";
export const prerender = false;

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

// Local development only: typing "admin" on the sign-in page signs in as the
// first address in ADMIN_EMAILS, through the real magic-link flow, without an
// email. The integration injects this route only for `astro dev`, and it
// refuses anything that is not a dev server on this machine.
export const POST: APIRoute = async ({ request, url }) => {
  if (!import.meta.env.DEV || !LOCAL_HOSTS.includes(url.hostname))
    return new Response(null, { status: 404 });
  const env = cmsEnv();
  const email = env.ADMIN_EMAILS.split(",")[0]?.trim().toLowerCase() ?? "";
  if (!email || !allowedAdmin(email, env.ADMIN_EMAILS))
    return Response.json(
      { error: "Add an address to ADMIN_EMAILS to sign in locally." },
      { status: 400 },
    );
  let next = "/admin/";
  try {
    const body = (await request.json()) as { next?: unknown };
    if (typeof body.next === "string" && /^\/(?!\/)/.test(body.next))
      next = body.next;
  } catch {
    /* default destination */
  }
  // Local sign-ins live in CMS_DB. Make sure the editor exists there, and
  // skip the one-link-a-minute limit.
  const db = serialiseD1(env.CMS_DB);
  await db
    .prepare(
      `INSERT INTO cms_auth_user (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(email) DO NOTHING`,
    )
    .bind(`local-${crypto.randomUUID()}`, email.split("@")[0], email)
    .run();
  await db
    .prepare("DELETE FROM cms_auth_email_limit WHERE email = ?")
    .bind(email)
    .run();
  localLinks.delete(email);
  const params = new URLSearchParams({ approved: "1", next });
  await loginAuth(request).api.signInMagicLink({
    body: { email, callbackURL: `/login/?${params}` },
    headers: request.headers,
  });
  const link = localLinks.get(email);
  if (!link)
    return Response.json(
      { error: "The local sign-in link was not created." },
      { status: 500 },
    );
  return Response.json({ url: link });
};

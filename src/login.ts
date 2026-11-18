import { env as workerEnv } from "cloudflare:workers";
import config from "virtual:clio/config";
import { createCmsAuth } from "./auth.ts";
import type { CmsEnv } from "./env.ts";
import { describeClient, loginEmail } from "./loginEmail.ts";
import { serialiseD1 } from "./serialD1.ts";

export const cmsEnv = () => workerEnv as unknown as CmsEnv;

export function loginAuth(request: Request) {
  const env = cmsEnv();
  const origin = new URL(request.url).origin;
  const local =
    import.meta.env.DEV &&
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);
  const database = serialiseD1(local || !env.AUTH_DB ? env.CMS_DB : env.AUTH_DB);
  return createCmsAuth({
    appName: config.appName,
    cookiePrefix: config.cookiePrefix,
    database,
    cookieDomain: local ? undefined : env.AUTH_COOKIE_DOMAIN,
    baseURL: local ? origin : env.AUTH_BASE_URL,
    secret: env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET || "",
    adminEmails: env.ADMIN_EMAILS,
    async reserveLink(email) {
      const result = await database
        .prepare(
          `INSERT INTO cms_auth_email_limit (email, nextSendAt) VALUES (?, ?)
         ON CONFLICT(email) DO UPDATE SET nextSendAt = excluded.nextSendAt
         WHERE cms_auth_email_limit.nextSendAt <= ?`,
        )
        .bind(email, Date.now() + 60000, Date.now())
        .run();
      return result.meta.changes === 1;
    },
    async revokeLinks(email) {
      await database
        .prepare(
          "DELETE FROM cms_auth_verification WHERE value LIKE ? OR identifier = ?",
        )
        .bind(`%"email":"${email}"%`, `sign-in-otp-${email}`)
        .run();
    },
    async sendLink(email, url, linkRequest, otp) {
      const message = loginEmail(
        url,
        describeClient(linkRequest?.headers.get("user-agent")),
        otp,
      );
      if (local) {
        // Development only: no real email is sent. Production builds remove this branch.
        console.info(
          JSON.stringify({ event: "local_login_link", email, url, otp }),
        );
        return;
      }
      try {
        await env.LOGIN_EMAIL.send({
          from: { email: env.LOGIN_FROM_EMAIL, name: config.appName },
          to: email,
          subject: message.subject,
          text: message.text,
          html: message.html,
        });
        console.info(JSON.stringify({ event: "login_email_sent" }));
      } catch {
        console.error(JSON.stringify({ event: "login_email_failed" }));
        throw new Error("Login email could not be sent.");
      }
    },
  });
}

// The signed-in editor's email, or null.
export async function currentEditor(request: Request) {
  const { authenticate } = await import("./auth.ts");
  return authenticate(request, loginAuth(request), cmsEnv().ADMIN_EMAILS);
}

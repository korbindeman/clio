import { env as workerEnv } from "cloudflare:workers";
import config from "virtual:clio/config";
import { createCmsAuth } from "./auth.ts";
import type { CmsEnv } from "./env.ts";
import { describeClient, loginEmail } from "./loginEmail.ts";
import { serialiseD1 } from "./serialD1.ts";

export const cmsEnv = () => workerEnv as unknown as CmsEnv;

// Development only: the last sign-in link made for each address, so the local
// dev sign-in (routes/devLogin.ts) can follow it without an email.
export const localLinks = new Map<string, string>();

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
        config.locale ?? "en",
      );
      if (local) {
        // Development only: no real email is sent. Production builds remove this branch.
        console.info(
          JSON.stringify({ event: "local_login_link", email, url, otp }),
        );
        localLinks.set(email, url);
        return;
      }
      try {
        if (env.RESEND_API_KEY) await sendWithResend(env, email, message);
        else if (env.LOGIN_EMAIL)
          await env.LOGIN_EMAIL.send({
            from: { email: env.LOGIN_FROM_EMAIL, name: config.appName },
            to: email,
            subject: message.subject,
            text: message.text,
            html: message.html,
          });
        else throw new Error("No sign-in email delivery is configured.");
        console.info(JSON.stringify({ event: "login_email_sent" }));
      } catch {
        console.error(JSON.stringify({ event: "login_email_failed" }));
        throw new Error("Login email could not be sent.");
      }
    },
  });
}

// Sites that already send their own mail through Resend (RESEND_API_KEY) send the
// sign-in email the same way, instead of Cloudflare Email Sending.
async function sendWithResend(
  env: CmsEnv,
  to: string,
  message: { subject: string; text: string; html: string },
) {
  const base = (env.RESEND_API_BASE || "https://api.resend.com").replace(/\/$/, "");
  const response = await fetch(`${base}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${config.appName} <${env.LOGIN_FROM_EMAIL}>`,
      to: [to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  });
  if (!response.ok) throw new Error(`Resend answered ${response.status}`);
}

// The signed-in editor's email, or null.
export async function currentEditor(request: Request) {
  const { authenticate } = await import("./auth.ts");
  return authenticate(request, loginAuth(request), cmsEnv().ADMIN_EMAILS);
}

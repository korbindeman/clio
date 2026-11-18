import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP, magicLink } from "better-auth/plugins";
import { loginDestination } from "./access.ts";
import { approvalPage } from "./approval.ts";

export const LOGIN_SECONDS = 600;

export type LoginConfig = {
  // Shown by the sign-in emails and pages, e.g. "Studio Name".
  appName: string;
  // Prefix for the session cookie names. Changing it signs everyone out.
  cookiePrefix: string;
  database: BetterAuthOptions["database"];
  baseURL: string;
  secret: string;
  adminEmails: string;
  cookieDomain?: string;
  sendLink: (
    email: string,
    url: string,
    request?: Request,
    otp?: string,
  ) => Promise<void>;
  reserveLink: (email: string) => Promise<boolean>;
  revokeLinks: (email: string) => Promise<void>;
};

// A sign-in lasts one week on that device and is never extended, so a device
// an editor stops using drops out on its own.
export const SESSION_SECONDS = 60 * 60 * 24 * 7;

export function allowedAdmin(email: string, allowlist: string): boolean {
  return allowlist
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.trim().toLowerCase());
}

export function approvedCallback(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/login/"))
    return "/login/?approved=1";
  try {
    const url = new URL(value, "https://local.invalid");
    if (url.origin !== "https://local.invalid") return "/login/?approved=1";
    const params = new URLSearchParams({ approved: "1" });
    const next = loginDestination(url.searchParams.get("next"), "");
    if (next) params.set("next", next);
    return `/login/?${params}`;
  } catch {
    return "/login/?approved=1";
  }
}

async function hashLoginToken(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function normalizedEmail(body: { email?: unknown } | undefined): string {
  return typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
}

export function createCmsAuth(config: LoginConfig) {
  if (config.secret.length < 32)
    throw new Error("Login secret is not configured.");
  const deliveryFailures = new WeakSet<Request>();
  const auth = betterAuth({
    appName: config.appName,
    baseURL: config.baseURL,
    basePath: "/api/auth",
    secret: config.secret,
    database: config.database,
    trustedOrigins: [config.baseURL],
    user: { modelName: "cms_auth_user" },
    account: { modelName: "cms_auth_account" },
    verification: { modelName: "cms_auth_verification" },
    session: {
      modelName: "cms_auth_session",
      expiresIn: SESSION_SECONDS,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    advanced: {
      cookiePrefix: config.cookiePrefix,
      ...(config.cookieDomain
        ? {
            crossSubDomainCookies: {
              enabled: true,
              domain: config.cookieDomain,
            },
          }
        : {}),
      useSecureCookies: config.baseURL.startsWith("https://"),
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "cms_auth_rate_limit",
      window: 60,
      max: 30,
      customRules: {
        "/sign-in/magic-link": { window: 60, max: 3 },
        "/magic-link/verify": { window: 60, max: 10 },
        "/sign-in/email-otp": { window: 60, max: 10 },
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.request && deliveryFailures.has(ctx.request)) {
          throw new APIError("SERVICE_UNAVAILABLE", {
            message: "The link could not be sent. Please try again later.",
          });
        }
        const signedIn = ctx.context.newSession?.user.email;
        if (
          signedIn &&
          (ctx.path === "/sign-in/email-otp" ||
            ctx.path === "/magic-link/verify")
        )
          await config.revokeLinks(signedIn.toLowerCase());
      }),
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/magic-link") {
          const email = normalizedEmail(ctx.body);
          ctx.body.email = email;
          ctx.body.callbackURL = approvedCallback(ctx.body.callbackURL);
          ctx.body.errorCallbackURL = "/login/";
          ctx.body.newUserCallbackURL = undefined;
          ctx.body.name = undefined;
          // Do not disclose which addresses can sign in or create links for strangers.
          if (!allowedAdmin(email, config.adminEmails))
            return ctx.json({ status: true });
          if (!(await config.reserveLink(email)))
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Wait one minute before requesting another link.",
            });
          await config.revokeLinks(email);
        }
        if (ctx.path === "/sign-in/email-otp") {
          const email = normalizedEmail(ctx.body);
          ctx.body.email = email;
          ctx.body.name = undefined;
          ctx.body.image = undefined;
          if (!allowedAdmin(email, config.adminEmails))
            throw new APIError("BAD_REQUEST", { message: "Invalid OTP" });
        }
      }),
    },
    plugins: [
      emailOTP({
        disableSignUp: true,
        expiresIn: LOGIN_SECONDS,
        otpLength: 6,
        allowedAttempts: 5,
        storeOTP: "hashed",
        rateLimit: { window: 60, max: 10 },
        async sendVerificationOTP() {
          // The code is sent with the magic link. This endpoint is not exposed.
        },
      }),
      magicLink({
        disableSignUp: true,
        expiresIn: LOGIN_SECONDS,
        storeToken: "hashed",
        async sendMagicLink({ email, url, token }, ctx) {
          if (!allowedAdmin(email, config.adminEmails)) return;
          try {
            const otp = await auth.api.createVerificationOTP({
              body: { email, type: "sign-in" },
            });
            await config.sendLink(email, approvalPage(url, config.baseURL), ctx?.request, otp);
          } catch {
            try {
              const hashed = await hashLoginToken(token);
              // Newer Better Auth versions prefix the stored identifier.
              for (const identifier of [hashed, `magic-link:${hashed}`])
                await ctx?.context.internalAdapter.deleteVerificationByIdentifier(
                  identifier,
                );
              await ctx?.context.internalAdapter.deleteVerificationByIdentifier(
                `sign-in-otp-${email}`,
              );
            } catch {
              /* The response hook still reports the delivery failure. */
            }
            if (ctx?.request) deliveryFailures.add(ctx.request);
            else throw new Error("Login email could not be sent.");
          }
        },
      }),
    ],
  });
  return auth;
}

export type CmsAuth = ReturnType<typeof createCmsAuth>;

export async function authenticate(
  request: Request,
  auth: CmsAuth,
  allowlist: string,
): Promise<string | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  const email = session?.user.email;
  return email && session.user.emailVerified && allowedAdmin(email, allowlist)
    ? email.toLowerCase()
    : null;
}

export function sameOrigin(request: Request): boolean {
  return (
    request.headers.get("Origin") === new URL(request.url).origin &&
    request.headers.get("Sec-Fetch-Site") !== "cross-site"
  );
}

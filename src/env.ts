// The Worker bindings and variables every CMS site provides (wrangler.jsonc).
export interface CmsEnv {
  CMS_DB: D1Database;
  // Sign-ins and sessions. Local development keeps them in CMS_DB.
  AUTH_DB?: D1Database;
  // WIP's content, read by the main site's "Import from WIP".
  WIP_DB?: D1Database;
  CMS_MEDIA: R2Bucket;
  CMS_ORIGINALS: R2Bucket;
  WIP_MEDIA?: R2Bucket;
  WIP_ORIGINALS?: R2Bucket;
  // Sign-in emails go through Cloudflare Email Sending (LOGIN_EMAIL), or through
  // Resend when RESEND_API_KEY is set. RESEND_API_BASE is for tests with a mock.
  LOGIN_EMAIL?: SendEmail;
  RESEND_API_KEY?: string;
  RESEND_API_BASE?: string;
  LOGIN_FROM_EMAIL: string;
  ADMIN_EMAILS: string;
  AUTH_BASE_URL: string;
  AUTH_COOKIE_DOMAIN?: string;
  BETTER_AUTH_SECRET?: string;
  // "true" puts every page behind sign-in (the WIP site).
  PRIVATE_PREVIEW?: string;
}

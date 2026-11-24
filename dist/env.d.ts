export interface CmsEnv {
    CMS_DB: D1Database;
    AUTH_DB?: D1Database;
    WIP_DB?: D1Database;
    CMS_MEDIA: R2Bucket;
    CMS_ORIGINALS: R2Bucket;
    WIP_MEDIA?: R2Bucket;
    WIP_ORIGINALS?: R2Bucket;
    LOGIN_EMAIL?: SendEmail;
    RESEND_API_KEY?: string;
    RESEND_API_BASE?: string;
    LOGIN_FROM_EMAIL: string;
    ADMIN_EMAILS: string;
    AUTH_BASE_URL: string;
    AUTH_COOKIE_DOMAIN?: string;
    BETTER_AUTH_SECRET?: string;
    PRIVATE_PREVIEW?: string;
}

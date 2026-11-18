// Provided by the integration (src/integration.ts) from the site's config.
declare module "virtual:clio/config" {
  const config: {
    appName: string;
    cookiePrefix: string;
    documents: Record<string, "list" | "object">;
  };
  export default config;
}

interface ImportMetaEnv {
  // Set by the integration: true in a static release build.
  readonly STATIC_RELEASE: boolean;
  // Where published media is served from. Unset, the site serves /media/ itself.
  readonly PUBLIC_MEDIA_ORIGIN?: string;
}

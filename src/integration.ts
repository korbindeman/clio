import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import type { DocumentKind } from "./snapshot.ts";

export interface CmsOptions {
  // Shown in sign-in emails and pages, e.g. "Studio Name".
  appName: string;
  // Prefix for the session cookie names. Changing it signs everyone out.
  cookiePrefix: string;
  // Every content document the site publishes, and its shape.
  documents: Record<string, DocumentKind>;
  // The site's own admin pages and API routes, relative to the project root,
  // e.g. "src/cms/pages". Injected outside a static release only.
  pages?: string;
  // A static release: no adapter, admin, auth or CMS routes, and every page
  // prerendered. Defaults to STATIC_RELEASE being set.
  release?: boolean;
}

const PACKAGE = "@korbindeman/clio";
// The package's dependencies, for Vite to optimize before the first request.
const CLIENT_DEPS = [
  "prosemirror-commands",
  "prosemirror-history",
  "prosemirror-inputrules",
  "prosemirror-keymap",
  "prosemirror-markdown",
  "prosemirror-model",
  "prosemirror-schema-list",
  "prosemirror-state",
  "prosemirror-view",
];
const SERVER_DEPS = [
  "better-auth",
  "better-auth/api",
  "better-auth/plugins",
  "image-size",
  "markdown-it",
  "zod",
];
const VIRTUAL = "virtual:clio/config";

// Routes every CMS site has. The site provides its own /login page, so it can
// carry the site's look, using SignIn.svelte.
export const CORE_ROUTES = [
  { pattern: "/api/auth/[...path]", entrypoint: `${PACKAGE}/routes/api/auth/[...path].js` },
  { pattern: "/logout", entrypoint: `${PACKAGE}/routes/logout.js` },
  { pattern: "/media/[...key]", entrypoint: `${PACKAGE}/routes/media/[...key].js` },
];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : /\.(astro|ts)$/.test(entry.name)
        ? [join(dir, entry.name)]
        : [],
  );
}

// src/cms/pages/admin/sources/index.astro -> /admin/sources
export function cmsRoutes(
  pages: string | undefined,
  root: string = process.cwd(),
): { pattern: string; entrypoint: string }[] {
  const site = pages
    ? files(join(root, pages)).map((file) => {
        const path = relative(join(root, pages), file).split(sep).join("/");
        const pattern = `/${path.replace(/\.(astro|ts)$/, "")}`.replace(
          /\/index$/,
          "",
        );
        return {
          pattern: pattern || "/",
          entrypoint: `./${pages.replace(/^\.\//, "").replace(/\/$/, "")}/${path}`,
        };
      })
    : [];
  return [...CORE_ROUTES, ...site].sort((a, b) =>
    a.pattern.localeCompare(b.pattern),
  );
}

export default function cms(options: CmsOptions): AstroIntegration {
  const release = options.release ?? !!process.env.STATIC_RELEASE;
  const runtimeConfig = {
    appName: options.appName,
    cookiePrefix: options.cookiePrefix,
    documents: options.documents,
  };
  return {
    name: PACKAGE,
    hooks: {
      "astro:config:setup": ({
        config,
        injectRoute,
        addMiddleware,
        updateConfig,
      }) => {
        updateConfig({
          vite: {
            plugins: [
              {
                name: `${PACKAGE}:config`,
                resolveId: (id: string) =>
                  id === VIRTUAL ? `\0${VIRTUAL}` : undefined,
                load: (id: string) =>
                  id === `\0${VIRTUAL}`
                    ? `export default ${JSON.stringify(runtimeConfig)};`
                    : undefined,
              },
            ],
            define: {
              "import.meta.env.STATIC_RELEASE": JSON.stringify(release),
            },
            // The package ships Svelte components and reads import.meta.env
            // and a virtual module, so Vite must compile it as source: never
            // pre-bundle it (that duplicates the Svelte runtime) and never
            // leave it to Node. Its own dependencies are optimized up front,
            // so a first request does not re-optimize and reload mid-session.
            optimizeDeps: {
              exclude: [PACKAGE],
              include: CLIENT_DEPS,
            },
            ssr: {
              noExternal: [PACKAGE],
              optimizeDeps: { exclude: [PACKAGE], include: SERVER_DEPS },
            },
            // Worker-only code is unreachable in a release but still
            // referenced, so leave the import unresolved.
            ...(release
              ? { build: { rolldownOptions: { external: ["cloudflare:workers"] } } }
              : {}),
          },
        });
        if (release) return;
        for (const route of cmsRoutes(options.pages, fileURLToPath(config.root)))
          injectRoute(route);
        addMiddleware({ entrypoint: `${PACKAGE}/middleware`, order: "pre" });
      },
      // A release renders every public page at build time from the snapshot.
      "astro:route:setup": ({ route }) => {
        if (release) route.prerender = true;
      },
    },
  };
}

# Clio

Clio is a small headless CMS core for content-driven [Astro](https://astro.build) sites on Cloudflare Workers. Editors sign in by email, edit drafts and publish. Content lives in D1, media in R2, and the public site can ship as plain static files.

It's built for my own client sites and isn't a supported product. It is a complete working setup, though, and you're welcome to use it or borrow from it.

## What it provides

- **Sign-in.** Email codes and magic links through [Better Auth](https://www.better-auth.com). Only the addresses in `ADMIN_EMAILS` can sign in, and sign-up is disabled.
- **Admin guard.** The admin pages and admin API need a signed-in editor, and writes must come from the site itself. With `PRIVATE_PREVIEW=true`, every page needs sign-in, which suits a work-in-progress copy of the site.
- **Documents.** Drafts, publishing and history in D1. Each document is one row, and every write checks its revision.
- **Media.** Image uploads with display sizes and placeholders, preview loops, MP3 sound, and a private bucket for originals, all in R2.
- **Static releases.** Production can be plain static files, built from a snapshot of the preview site's published content (`release`) and checked before it ships (`verify-release`).
- **Admin building blocks.** `SignIn.svelte`, `RichText.svelte` (a WYSIWYG field that stores Markdown), and safe Markdown rendering.

The site keeps its own content model, admin pages and look. This package handles sign-in, storage, publishing and releases.

## How a site is set up

A site runs as two Workers built from the same code:

- **Preview (WIP).** The CMS lives here. Editors sign in, upload, and publish. `PRIVATE_PREVIEW=true` keeps it behind sign-in. Public pages are rendered on request from the published content in D1, so publishing takes effect immediately.
- **Production.** Either the same Worker without `PRIVATE_PREVIEW`, or a static release. A static release is built from the preview site's published content and media and has no admin, auth or API routes.

## Install

The package isn't on npm. Install it from Git at a tag or commit:

```sh
bun add git+https://github.com/korbindeman/clio.git#<tag-or-commit>
```

Peer dependencies: `astro`, `@astrojs/cloudflare`, `svelte`, `better-auth`, `zod`, `markdown-it`, `image-size` and the `prosemirror-*` packages listed in `package.json`.

## Use in a site

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import svelte from "@astrojs/svelte";
import cms from "@korbindeman/clio";

const release = !!process.env.STATIC_RELEASE;

export default defineConfig({
  output: "static",
  adapter: release ? undefined : cloudflare(),
  integrations: [
    cms({
      appName: "Studio Name", // shown in sign-in emails and pages
      cookiePrefix: "studio", // changing it signs everyone out
      documents: { home: "object", projects: "list" },
      pages: "src/cms/pages", // the site's own admin pages and API routes
      release,
    }),
    svelte(),
  ],
});
```

The integration adds `/api/auth/*`, `/logout`, `/media/*` and the admin middleware, and leaves all of them out of a static release (`STATIC_RELEASE=1`). Pages under `pages` are injected the same way, so admin pages and admin API routes go there. The site provides its own `/login` page with `SignIn.svelte`, so it can carry the site's look.

- **Worker entry:** set `src/worker.ts` (wrangler `main`) to `export { default } from "@korbindeman/clio/worker";`.
- **Bindings:** see `src/env.ts`: `CMS_DB`, `AUTH_DB`, `CMS_MEDIA`, `CMS_ORIGINALS`, `LOGIN_EMAIL` (Cloudflare Email Sending), `LOGIN_FROM_EMAIL`, `ADMIN_EMAILS`, `AUTH_BASE_URL`, `AUTH_COOKIE_DOMAIN`, `BETTER_AUTH_SECRET` (a secret) and `PRIVATE_PREVIEW`.
- **Migrations:** copy `migrations/0001_cms.sql` into the site's `migrations/` and `migrations/auth-0001_login.sql` into its `auth-migrations/`. Then add each editor to `cms_auth_user` in a later migration (the auth migration shows how).
- **Admin API:** build routes with `readRow`, `saveDraft`, `publishDocument` and friends from `@korbindeman/clio/store`, and image uploads with `readImageForm` from `@korbindeman/clio/upload` and `putMedia` from `@korbindeman/clio/media`. The middleware puts the editor's email in `Astro.locals.adminEmail`.
- **Public pages:** read content with `loadPublished(id)` from `@korbindeman/clio/published`. It reads D1 on the preview Worker and the snapshot in a static release. Dynamic routes add a `getStaticPaths` for the release build.
- **Scripts:** a site's `scripts/release.mjs` calls `release()` from `@korbindeman/clio/release`, and `scripts/deploy.mjs` calls `deploy()` from `@korbindeman/clio/deploy`. `release()` takes `files` for extra files in the release, such as a `_redirects` that sends `/admin` to the preview site.

Locally (`astro dev` on localhost), no email is sent. The sign-in link and code are printed in the dev server log, and sign-ins are kept in `CMS_DB`.

To skip even that, type `admin` as the email on the sign-in page. The dev server signs you in as the first address in `ADMIN_EMAILS` and shows the welcome screen. The shortcut route (`/api/dev-login`) is only injected by `astro dev` and answers 404 to anything but localhost, so builds never have it.

## Development

```sh
bun install
bun run verify   # build, type check, tests, and a check that dist/ is committed up to date
```

`dist/` is committed, so sites can install straight from Git without a build step. Run `bun run build` and commit `dist/` with every source change. To release, tag the commit (for example `v0.1.0`) and point each site's dependency at the tag.

## License

[MIT](LICENSE)

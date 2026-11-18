import { handle } from "@astrojs/cloudflare/handler";
import { previewResponse } from "./access.ts";
import type { CmsEnv } from "./env.ts";
import { serialiseBindings } from "./serialD1.ts";

// The site's Worker entry (wrangler.jsonc "main"): re-export this as default.
// With PRIVATE_PREVIEW=true (the WIP site) every page and file needs sign-in
// before Cloudflare serves it.
export default {
  async fetch(request, env, context) {
    env = serialiseBindings(env);
    if (env.PRIVATE_PREVIEW !== "true")
      return handle(request, env as never, context);
    return previewResponse(
      request,
      async () => {
        const { currentEditor } = await import("./login.ts");
        return currentEditor(request);
      },
      () => handle(request, env as never, context),
    );
  },
} satisfies ExportedHandler<CmsEnv>;

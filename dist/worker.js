import { handle } from "@astrojs/cloudflare/handler";
import { previewResponse } from "./access.js";
import { serialiseBindings } from "./serialD1.js";
// The site's Worker entry (wrangler.jsonc "main"): re-export this as default.
// With PRIVATE_PREVIEW=true (the WIP site) every page and file needs sign-in
// before Cloudflare serves it.
export default {
    async fetch(request, env, context) {
        env = serialiseBindings(env);
        if (env.PRIVATE_PREVIEW !== "true")
            return handle(request, env, context);
        return previewResponse(request, async () => {
            const { currentEditor } = await import("./login.js");
            return currentEditor(request);
        }, () => handle(request, env, context));
    },
};

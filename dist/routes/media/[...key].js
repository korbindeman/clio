import { cmsEnv } from "../../login.js";
import { IMMUTABLE, serveMedia } from "../../media.js";
export const prerender = false;
// Serves the public bucket where no media domain is configured: local development
// and tests. Deployed sites link to the media domain instead (see mediaUrl.ts).
export const GET = async ({ request, params }) => {
    const key = params.key ?? "";
    if (!/^[a-zA-Z0-9-]{1,64}\/(?:\d+\.(?:webp|jpg)|share\.jpg|clip\.mp4|audio\.mp3)$/.test(key))
        return new Response(null, { status: 404 });
    return serveMedia(request, cmsEnv().CMS_MEDIA, key, IMMUTABLE);
};

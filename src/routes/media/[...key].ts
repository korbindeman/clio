import type { APIRoute } from "astro";
import { cmsEnv } from "../../login.ts";
import { IMMUTABLE, serveMedia } from "../../media.ts";
export const prerender = false;
// Serves the public bucket where no media domain is configured: local development
// and tests. Deployed sites link to the media domain instead (see mediaUrl.ts).
export const GET: APIRoute = async ({ request, params }) => {
  const key = params.key ?? "";
  if (
    !/^[a-zA-Z0-9-]{1,64}\/(?:\d+\.(?:webp|jpg|png)|share\.jpg|clip\.mp4|audio\.mp3)$/.test(
      key,
    )
  )
    return new Response(null, { status: 404 });
  return serveMedia(request, cmsEnv().CMS_MEDIA, key, IMMUTABLE);
};

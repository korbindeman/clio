function contentRange(range: R2Range, size: number) {
  const { offset, length, suffix } = range as {
    offset?: number;
    length?: number;
    suffix?: number;
  };
  const start =
    suffix === undefined ? (offset ?? 0) : Math.max(0, size - suffix);
  const end = Math.min(size, length === undefined ? size : start + length);
  return `bytes ${start}-${end - 1}/${size}`;
}
const TYPES: Record<string, string> = {
  webp: "image/webp",
  jpg: "image/jpeg",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
};
// Serves one stored media file. Browsers ask for byte ranges to play and seek
// video and sound.
export async function serveMedia(
  request: Request,
  bucket: R2Bucket,
  key: string,
  cacheControl: string,
) {
  const extension = key.split(".").pop()!;
  const clip = extension === "mp4" || extension === "mp3";
  const object = await bucket.get(
    key,
    clip ? { range: request.headers } : undefined,
  );
  if (!object) return new Response(null, { status: 404 });
  const partial = clip && object.range && request.headers.has("range");
  return new Response(object.body, {
    status: partial ? 206 : 200,
    headers: {
      "Content-Type": TYPES[extension],
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": cacheControl,
      ETag: object.httpEtag,
      ...(clip ? { "Accept-Ranges": "bytes" } : {}),
      ...(partial
        ? { "Content-Range": contentRange(object.range!, object.size) }
        : {}),
    },
  });
}

export const IMMUTABLE = "public, max-age=31536000, immutable";
export interface Buckets {
  CMS_MEDIA: R2Bucket;
  CMS_ORIGINALS: R2Bucket;
}
const isOriginal = (key: string) => key.startsWith("originals/");
// Originals stay private. Every other file is public and never changes under its name.
export async function putMedia(
  buckets: Buckets,
  key: string,
  body: ReadableStream | ArrayBuffer,
  contentType: string,
) {
  const original = isOriginal(key);
  await (original ? buckets.CMS_ORIGINALS : buckets.CMS_MEDIA).put(key, body, {
    httpMetadata: original
      ? { contentType }
      : { contentType, cacheControl: IMMUTABLE },
  });
}
export async function deleteMedia(buckets: Buckets, keys: string[]) {
  const originals = keys.filter(isOriginal);
  const published = keys.filter((key) => !isOriginal(key));
  if (published.length) await buckets.CMS_MEDIA.delete(published);
  if (originals.length) await buckets.CMS_ORIGINALS.delete(originals);
}

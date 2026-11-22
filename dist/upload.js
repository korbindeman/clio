import { imageSize } from "image-size";
import { placeholderSchema } from "./image.js";
import { shareImage } from "./share.js";
// Workers accept request bodies up to 100 MB.
export const MAX_UPLOAD = 64 * 1024 * 1024;
export async function readLimited(request, limit) {
    if (Number(request.headers.get("content-length")) > limit)
        return null;
    const reader = request.body?.getReader();
    if (!reader)
        return new Uint8Array();
    let size = 0;
    const chunks = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        size += value.byteLength;
        if (size > limit) {
            await reader.cancel();
            return null;
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }
    return bytes;
}
export function inspectImage(bytes, types = ["jpg", "png", "webp"]) {
    const result = imageSize(bytes);
    if (!result.type || !types.includes(result.type))
        throw new Error("Use a JPEG, PNG, or WebP photograph.");
    if (!result.width ||
        !result.height ||
        result.width > 30000 ||
        result.height > 30000 ||
        result.width * result.height > 100_000_000)
        throw new Error("Photographs must be no larger than 100 megapixels.");
    return result;
}
// Reads an original and its browser-made display copies, and checks them all.
export async function readImageForm(form, id) {
    const original = form.get("original");
    if (!(original instanceof File) || original.size > 30 * 1024 * 1024)
        throw new Error("Choose an original smaller than 30 MB.");
    const info = inspectImage(new Uint8Array(await original.arrayBuffer()));
    const rotate = [5, 6, 7, 8].includes(info.orientation ?? 1);
    const width = rotate ? info.height : info.width;
    const height = rotate ? info.width : info.height;
    const originalKey = `originals/${id}.${info.type}`;
    const objects = [
        {
            key: originalKey,
            file: original,
            type: `image/${info.type === "jpg" ? "jpeg" : info.type}`,
        },
    ];
    const variants = [];
    const expected = [
        ...new Set([320, 640, 960, 1440, 1920, 2560].map((n) => Math.min(n, width))),
    ];
    for (const size of expected) {
        const file = form.get(String(size));
        // PNG (transparent cut-outs from Safari) is lossless, so it may be larger.
        if (!(file instanceof File) || file.size > 12 * 1024 * 1024)
            throw new Error("An image preview is missing or too large.");
        // WebP, or from browsers that cannot encode WebP (Safari) JPEG, or PNG
        // for a cut-out that must stay transparent.
        const dimensions = inspectImage(new Uint8Array(await file.arrayBuffer()), [
            "webp",
            "jpg",
            "png",
        ]);
        if (dimensions.width !== size ||
            Math.abs(dimensions.height - Math.round((height * size) / width)) > 1)
            throw new Error("An image preview has invalid dimensions.");
        const extension = dimensions.type;
        const key = `${id}/${size}.${extension}`;
        objects.push({
            key,
            file,
            type: `image/${extension === "jpg" ? "jpeg" : extension}`,
        });
        variants.push({ width: size, src: `/media/${key}` });
    }
    const placeholder = placeholderSchema.safeParse(form.get("placeholder"));
    if (!placeholder.success)
        throw new Error("The image placeholder is invalid.");
    const sharePreview = form.get("share");
    if (!(sharePreview instanceof File) || sharePreview.size > 2 * 1024 * 1024)
        throw new Error("The link preview image is missing or too large.");
    const shape = inspectImage(new Uint8Array(await sharePreview.arrayBuffer()), [
        "jpg",
    ]);
    const expectedShare = shareImage(id, width, height);
    if (Math.abs(shape.width - expectedShare.width) > 1 ||
        Math.abs(shape.height - expectedShare.height) > 1)
        throw new Error("The link preview image has invalid dimensions.");
    objects.push({
        key: `${id}/share.jpg`,
        file: sharePreview,
        type: "image/jpeg",
    });
    return {
        width,
        height,
        variants,
        placeholder: placeholder.data,
        originalKey,
        objects,
    };
}
export const MAX_CLIP = 30 * 1024 * 1024;
export function inspectClip(bytes) {
    // Every MP4 starts with a box whose type is "ftyp".
    if (new TextDecoder().decode(bytes.subarray(4, 8)) !== "ftyp")
        throw new Error("Use an MP4 preview.");
}
const ascii = (bytes, at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
// An MP4 with sound has a track whose handler ("hdlr" box) is "soun".
export function hasAudioTrack(bytes) {
    for (let at = 4; at + 12 <= bytes.length; at++)
        if (bytes[at] === 0x68 &&
            ascii(bytes, at) === "hdlr" &&
            ascii(bytes, at + 12) === "soun")
            return true;
    return false;
}
// Static releases reject files above 25 MiB, so a sound file stays below it.
export const MAX_AUDIO = 25 * 1024 * 1024;
export function inspectAudio(bytes) {
    // An MP3 starts with an ID3 tag or an MPEG audio frame sync.
    const id3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
    const frame = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
    if (bytes.length < 4 || !(id3 || frame))
        throw new Error("Use an MP3 file.");
}

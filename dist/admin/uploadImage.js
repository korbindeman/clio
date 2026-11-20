import { shareImage } from "../share.js";
// The browser makes an uploaded photo's display sizes, link preview and
// placeholder, so the Worker never decodes images. The server half is
// receiveImageUpload (imageUpload.ts).
function send(path, form, progress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", path);
        xhr.timeout = 120000;
        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable)
                progress(`Uploading ${Math.round((event.loaded / event.total) * 100)}%`);
        };
        xhr.onerror = () => reject(new Error("Upload interrupted. Check your connection and try again."));
        xhr.ontimeout = () => reject(new Error("Upload timed out. Please try again."));
        xhr.onload = () => {
            try {
                const data = JSON.parse(xhr.responseText);
                if (xhr.status >= 200 && xhr.status < 300)
                    resolve(data);
                else
                    reject(new Error(data.error || "Upload failed. Please sign in again if your session expired."));
            }
            catch {
                reject(new Error("Upload failed. Your session may have expired; sign in again."));
            }
        };
        xhr.send(form);
    });
}
async function draw(bitmap, width, height, type, quality) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context)
        throw new Error("Your browser could not prepare the photo.");
    if (type === "image/jpeg") {
        // JPEG has no transparency: a cut-out PNG gets white, not black.
        context.fillStyle = "#fff";
        context.fillRect(0, 0, width, height);
    }
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not prepare the photo."))), type, quality));
    canvas.width = canvas.height = 0;
    return blob;
}
// Safari cannot encode WebP from a canvas: it silently makes a PNG instead,
// which made every display size several megabytes. Those browsers send JPEG.
let webp;
function encodesWebp() {
    webp ??= new Promise((resolve) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        canvas.toBlob((b) => resolve(b?.type === "image/webp"), "image/webp", 0.8);
    });
    return webp;
}
// iOS Safari refuses canvases above ~16.7 million pixels.
const MAX_CANVAS = 16_000_000;
// Originals the server keeps as they are: a common format under this size.
const KEEP_ORIGINAL = 20 * 1024 * 1024;
const SERVER_TYPES = ["image/jpeg", "image/png", "image/webp"];
// `reduced` is true when only a smaller copy could be decoded.
async function decode(file) {
    try {
        return { bitmap: await createImageBitmap(file), reduced: false };
    }
    catch {
        // Very large photos can fail at full size: decode a smaller copy.
        try {
            const bitmap = await createImageBitmap(file, {
                resizeWidth: 4000,
                resizeQuality: "high",
            });
            return { bitmap, reduced: true };
        }
        catch {
            throw new Error(`${file.name}: this browser can't open that photo. Export it as a JPEG and try again.`);
        }
    }
}
// The original to keep, and its size. Anything the server can't store as it
// is (HEIC, AVIF, huge files or dimensions) is redrawn as a high-quality JPEG
// in the browser, so any photo the browser can open can be uploaded.
async function prepareOriginal(file, bitmap, reduced) {
    const pixels = bitmap.width * bitmap.height;
    const keep = !reduced &&
        SERVER_TYPES.includes(file.type) &&
        file.size <= KEEP_ORIGINAL &&
        pixels <= 100_000_000;
    if (keep)
        return { blob: file, width: bitmap.width, height: bitmap.height, name: file.name };
    const scale = Math.min(1, Math.sqrt(MAX_CANVAS / pixels));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    for (const quality of [0.92, 0.85, 0.75]) {
        const blob = await draw(bitmap, width, height, "image/jpeg", quality);
        if (blob.size <= KEEP_ORIGINAL)
            return { blob, width, height, name: file.name.replace(/\.[^.]*$/, "") + ".jpg" };
    }
    throw new Error(`${file.name} is too detailed to upload. Try a smaller export.`);
}
const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not prepare the photo."));
    reader.readAsDataURL(blob);
});
// Any image the browser can open. Sites filter files with `isImageFile`.
export const IMAGE_TYPES = "image/*,.heic,.heif,.avif";
export const isImageFile = (file) => file.type.startsWith("image/") || /\.(heic|heif|avif)$/i.test(file.name);
// Sends the original and its display sizes to `path` (an admin API route),
// with `fields` as extra form fields. Resolves with the route's JSON.
export async function uploadImage(path, file, revision, progress = () => { }, fields = {}) {
    if (!isImageFile(file))
        throw new Error(`${file.name}: choose a photo.`);
    progress("Preparing…");
    const { bitmap, reduced } = await decode(file);
    try {
        const original = await prepareOriginal(file, bitmap, reduced);
        const variantType = (await encodesWebp()) ? "image/webp" : "image/jpeg";
        const extension = variantType === "image/webp" ? "webp" : "jpg";
        const sized = (width) => Math.max(1, Math.round((original.height * width) / original.width));
        const form = new FormData();
        form.append("revision", String(revision));
        for (const [name, value] of Object.entries(fields))
            form.append(name, value);
        form.append("original", original.blob, original.name);
        for (const width of [
            ...new Set([320, 640, 960, 1440, 1920, 2560].map((n) => Math.min(n, original.width))),
        ])
            form.append(String(width), await draw(bitmap, width, sized(width), variantType, 0.82), `${width}.${extension}`);
        const share = shareImage("", original.width, original.height);
        form.append("share", await draw(bitmap, share.width, share.height, "image/jpeg", 0.82), "share.jpg");
        form.append("placeholder", await blobToDataUrl(await draw(bitmap, 24, sized(24), variantType, 0.4)));
        return await send(path, form, progress);
    }
    finally {
        bitmap.close();
    }
}

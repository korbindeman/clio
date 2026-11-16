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
async function resize(bitmap, width, type, quality) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
    const context = canvas.getContext("2d");
    if (!context)
        throw new Error("Your browser could not prepare the photo.");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not prepare the photo."))), type, quality));
    canvas.width = canvas.height = 0;
    return blob;
}
const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not prepare the photo."));
    reader.readAsDataURL(blob);
});
export const IMAGE_TYPES = "image/jpeg,image/png,image/webp";
// Sends the original and its display sizes to `path` (an admin API route),
// with `fields` as extra form fields. Resolves with the route's JSON.
export async function uploadImage(path, file, revision, progress = () => { }, fields = {}) {
    if (!IMAGE_TYPES.split(",").includes(file.type))
        throw new Error(`${file.name}: choose a JPEG, PNG or WebP photo.`);
    if (file.size > 30 * 1024 * 1024)
        throw new Error(`${file.name} is larger than 30 MB.`);
    progress("Preparing…");
    const bitmap = await createImageBitmap(file);
    try {
        if (bitmap.width * bitmap.height > 100_000_000)
            throw new Error("Choose a photo smaller than 100 megapixels.");
        const form = new FormData();
        form.append("revision", String(revision));
        for (const [name, value] of Object.entries(fields))
            form.append(name, value);
        form.append("original", file);
        for (const width of [
            ...new Set([320, 640, 960, 1440, 1920, 2560].map((n) => Math.min(n, bitmap.width))),
        ])
            form.append(String(width), await resize(bitmap, width, "image/webp", 0.82), `${width}.webp`);
        const share = shareImage("", bitmap.width, bitmap.height);
        form.append("share", await resize(bitmap, share.width, "image/jpeg", 0.82), "share.jpg");
        form.append("placeholder", await blobToDataUrl(await resize(bitmap, 24, "image/webp", 0.4)));
        return await send(path, form, progress);
    }
    finally {
        bitmap.close();
    }
}

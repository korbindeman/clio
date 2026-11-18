import { z } from "zod";
import { mediaUrl } from "./mediaUrl.js";
// Every uploaded image has an id, a set of display widths, and a tiny
// placeholder. Sites build their own item schemas from these parts.
export const mediaId = z.string().regex(/^[a-zA-Z0-9-]{1,64}$/);
export const variantSchema = z.object({
    width: z.number().int().positive().max(2560),
    src: z.string().regex(/^\/media\/[a-zA-Z0-9-]{1,64}\/\d+\.webp$/),
});
// A tiny blurred copy that paints before the real image arrives.
export const placeholderSchema = z
    .string()
    .regex(/^data:image\/webp;base64,[A-Za-z0-9+/=]{1,2000}$/);
// The fields an uploaded image carries in a document.
export const imageFields = {
    id: mediaId,
    width: z.number().int().positive().max(30000),
    height: z.number().int().positive().max(30000),
    variants: z.array(variantSchema).min(1).max(6),
    placeholder: placeholderSchema,
};
export const imageSchema = z.object(imageFields);
export function imageProps(image) {
    const variants = [...image.variants].sort((a, b) => a.width - b.width);
    return {
        src: mediaUrl(variants.at(-1).src),
        thumbnail: mediaUrl((variants.find((v) => v.width >= 640) ?? variants.at(-1)).src),
        srcset: variants.map((v) => `${mediaUrl(v.src)} ${v.width}w`).join(", "),
    };
}
const MEDIA = /\/media\/([a-zA-Z0-9-]{1,64}\/(?:\d+\.webp|share\.jpg|clip\.mp4))/g;
// Every media key a built page or file refers to, e.g. "abc/640.webp".
export function mediaKeysIn(text) {
    return new Set([...text.matchAll(MEDIA)].map((match) => match[1]));
}

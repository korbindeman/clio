// Link previews need a JPEG; it is stored beside the display sizes.
export const SHARE_EDGE = 1200;
export function shareImage(id, width, height) {
    const scale = Math.min(1, SHARE_EDGE / Math.max(width, height));
    return {
        src: `/media/${id}/share.jpg`,
        width: Math.round(width * scale),
        height: Math.round(height * scale),
    };
}

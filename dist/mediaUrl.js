// Published and draft media live in a public bucket on its own domain. The build
// sets PUBLIC_MEDIA_ORIGIN per site. Without it (local development and tests),
// the site serves media itself under /media/.
const origin = import.meta.env?.PUBLIC_MEDIA_ORIGIN ?? "";
export const mediaUrl = (src) => origin ? origin + src.replace(/^\/media/, "") : src;

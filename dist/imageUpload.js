import { cmsEnv } from "./login.js";
import { deleteMedia, putMedia } from "./media.js";
import { saveDocumentWithMedia } from "./store.js";
import { MAX_UPLOAD, readImageForm, readLimited } from "./upload.js";
// Receives one image from the admin's `uploadImage` (admin/uploadImage.ts):
// the original and its browser-made display sizes. The files go to R2, then
// `change` puts the image into the document's draft, in one write guarded by
// the revision. Returns a Response for anything the editor should be told.
export async function receiveImageUpload(request, documentId, actor, change) {
    const env = cmsEnv();
    const bytes = await readLimited(request, MAX_UPLOAD);
    if (!bytes)
        return Response.json({ error: "Upload exceeds 64 MB. Choose a smaller original." }, { status: 413 });
    const id = crypto.randomUUID();
    let form;
    let revision;
    let read;
    try {
        form = await new Response(bytes, {
            headers: { "Content-Type": request.headers.get("Content-Type") || "" },
        }).formData();
        revision = Number(form.get("revision"));
        if (!Number.isSafeInteger(revision) || revision < 1)
            throw new Error("Reload the page before uploading.");
        read = await readImageForm(form, id);
    }
    catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Invalid image upload." }, { status: 400 });
    }
    const image = {
        id,
        width: read.width,
        height: read.height,
        variants: read.variants,
        placeholder: read.placeholder,
    };
    const keys = read.objects.map((o) => o.key);
    let row;
    try {
        for (const object of read.objects)
            await putMedia(env, object.key, object.file.stream(), object.type);
        row = await saveDocumentWithMedia(env.CMS_DB, documentId, revision, actor, (draft) => change(draft, image, form), env.CMS_DB.prepare("INSERT INTO cms_media(id, width, height, variants, original_key, created_at, actor) VALUES(?, ?, ?, ?, ?, ?, ?)").bind(id, image.width, image.height, JSON.stringify(image.variants), read.originalKey, new Date().toISOString(), actor));
    }
    catch (error) {
        await deleteMedia(env, keys);
        throw error;
    }
    if (!row) {
        await deleteMedia(env, keys);
        return Response.json({ error: "This page changed in another window. Reload before uploading again." }, { status: 409 });
    }
    console.info(JSON.stringify({ event: "cms_upload", mediaId: id, document: documentId, actor }));
    return { row, image, form };
}

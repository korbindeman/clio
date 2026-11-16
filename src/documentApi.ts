import type { APIRoute } from "astro";
import type { z } from "zod";
import { cmsEnv } from "./login.ts";
import {
  documentMeta,
  initializeDocuments,
  publishDocument,
  readRow,
  saveDraft,
  uploadedMedia,
  sameMedia,
  type DocumentRow,
} from "./store.ts";
import { readLimited } from "./upload.ts";

// One content document as the admin sees it: its draft plus publish state.
export interface EditableDocument<T> {
  draft: T;
  revision: number;
  publishedAt: string | null;
  hasChanges: boolean;
}

export interface DocumentDefinition<T> {
  id: string;
  schema: z.ZodType<T>;
  // The first version: created as both draft and published on first read.
  seed: T;
  // Largest draft the admin may save, in bytes.
  maxBytes?: number;
}

const actorOf = (locals: unknown) =>
  (locals as { adminEmail?: string }).adminEmail ?? "unknown";

export function toEditable<T>(
  doc: DocumentDefinition<T>,
  row: DocumentRow,
): EditableDocument<T> {
  return { draft: doc.schema.parse(JSON.parse(row.draft)), ...documentMeta(row) };
}

export async function readDocument<T>(
  doc: DocumentDefinition<T>,
  actor: string,
): Promise<EditableDocument<T>> {
  const db = cmsEnv().CMS_DB;
  let row = await readRow(db, doc.id);
  if (!row) {
    await initializeDocuments(db, { [doc.id]: doc.seed }, actor);
    row = (await readRow(db, doc.id))!;
  }
  return toEditable(doc, row);
}

// Every uploaded image a draft points at must be one this site stored.
const isUploaded = (value: unknown): value is { id: string; width: number; height: number; variants: unknown } =>
  !!value &&
  typeof value === "object" &&
  typeof (value as { id?: unknown }).id === "string" &&
  Array.isArray((value as { variants?: unknown }).variants);
function uploadedImagesIn(value: unknown, found: any[] = []) {
  if (isUploaded(value)) found.push(value);
  else if (Array.isArray(value)) for (const v of value) uploadedImagesIn(v, found);
  else if (value && typeof value === "object")
    for (const v of Object.values(value)) uploadedImagesIn(v, found);
  return found;
}

// GET reads the draft, PUT saves it whole (409 when another window saved
// first). Use as `export const { GET, PUT } = documentRoutes(definition)`.
export function documentRoutes<T>(doc: DocumentDefinition<T>): {
  GET: APIRoute;
  PUT: APIRoute;
} {
  return {
    GET: async ({ locals }) => Response.json(await readDocument(doc, actorOf(locals))),
    PUT: async ({ request, locals }) => {
      const bytes = await readLimited(request, doc.maxBytes ?? 1024 * 1024);
      if (!bytes)
        return Response.json({ error: "The draft is too large." }, { status: 413 });
      let input: { revision?: unknown; draft?: unknown };
      try {
        input = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return Response.json({ error: "Invalid request." }, { status: 400 });
      }
      const revision = Number(input.revision);
      if (!Number.isSafeInteger(revision) || revision < 1)
        return Response.json({ error: "Invalid draft version." }, { status: 400 });
      const parsed = doc.schema.safeParse(input.draft);
      if (!parsed.success)
        return Response.json(
          { error: parsed.error.issues[0]?.message ?? "Check the details and try again." },
          { status: 400 },
        );
      const db = cmsEnv().CMS_DB;
      const images = uploadedImagesIn(parsed.data);
      if (images.length) {
        const media = await uploadedMedia(db);
        if (!images.every((image) => sameMedia(media.get(image.id), image)))
          return Response.json(
            { error: "One of the photos has not finished uploading." },
            { status: 400 },
          );
      }
      const row = await saveDraft(db, doc.id, revision, parsed.data, actorOf(locals));
      if (!row)
        return Response.json(
          { error: "This changed in another window. Reload before saving; your changes have not been saved." },
          { status: 409 },
        );
      return Response.json(toEditable(doc, row));
    },
  };
}

// POST { document, revision } publishes that saved draft. `documents` lists
// every document the admin may publish.
export function publishRoute(documents: DocumentDefinition<any>[]): APIRoute {
  return async ({ request, locals }) => {
    const bytes = await readLimited(request, 1000);
    let input: { document?: unknown; revision?: unknown } = {};
    try {
      input = JSON.parse(new TextDecoder().decode(bytes ?? new Uint8Array()));
    } catch {
      /* rejected below */
    }
    const doc = documents.find((d) => d.id === input.document);
    const revision = Number(input.revision);
    if (!doc || !Number.isSafeInteger(revision) || revision < 1)
      return Response.json({ error: "Invalid draft version." }, { status: 400 });
    const row = await publishDocument(cmsEnv().CMS_DB, doc.id, revision, actorOf(locals));
    if (!row)
      return Response.json(
        { error: "This draft changed. Reload before publishing." },
        { status: 409 },
      );
    console.info(JSON.stringify({ event: "cms_published", document: doc.id, actor: actorOf(locals) }));
    return Response.json(toEditable(doc, row));
  };
}

// Content lives in one table, one row per document: an editable draft, the
// published copy the public pages read, and a revision that guards every write.
// A trigger copies each previous version into cms_history.

export type DocumentId = string;
export interface DocumentRow {
  draft: string;
  published: string | null;
  revision: number;
  published_at: string | null;
}
export interface DocumentMeta {
  revision: number;
  publishedAt: string | null;
  hasChanges: boolean;
}

export const d1Busy = (error: unknown) => {
  const parts = [error instanceof Error ? error.message : String(error)];
  if (error instanceof Error && error.cause != null)
    parts.push(
      error.cause instanceof Error ? error.cause.message : String(error.cause),
    );
  return /SQLITE_BUSY|SQLITE_LOCKED|database is locked|D1_ERROR:.*busy|connection is busy/i.test(
    parts.join(" "),
  );
};
// D1 work is serialised at the binding. This helper stays so call sites remain
// explicit; it does not retry, which hid lock contention behind 500s.
export async function d1Retry<T>(op: () => Promise<T>): Promise<T> {
  return op();
}
// A busy database after a write may still have applied it. If the revision
// moved, report a conflict (null); otherwise the write failed.
async function conflictIfBusy(
  db: D1Database,
  id: DocumentId,
  revision: number,
  error: unknown,
) {
  if (!d1Busy(error)) throw error;
  const row = await readRow(db, id).catch(() => null);
  if (!row || row.revision !== revision) return null;
  throw error;
}

// What publishing a draft makes public. A list drops its removed items, which
// are never published and so never count as a pending change. Any other
// document is published as it is.
export function publishable(draft: string): string {
  const value = JSON.parse(draft) as unknown;
  return JSON.stringify(
    Array.isArray(value)
      ? value.filter((item) => !(item as { removed?: boolean })?.removed)
      : value,
  );
}
// Kept under its original name for list documents.
export const visibleItems = publishable;

export const documentMeta = (row: DocumentRow): DocumentMeta => ({
  revision: row.revision,
  publishedAt: row.published_at,
  hasChanges: publishable(row.draft) !== row.published,
});

export async function readRow(db: D1Database, id: DocumentId) {
  return d1Retry(() =>
    db
      .prepare(
        "SELECT draft, published, revision, published_at FROM cms_documents WHERE id = ?",
      )
      .bind(id)
      .first<DocumentRow>(),
  );
}

// Creates each missing document with its initial content, published as is.
export async function initializeDocuments(
  db: D1Database,
  documents: Record<DocumentId, unknown>,
  actor: string,
) {
  const now = new Date().toISOString();
  for (const [id, initial] of Object.entries(documents)) {
    const json = JSON.stringify(initial);
    await d1Retry(() =>
      db
        .prepare(
          "INSERT OR IGNORE INTO cms_documents(id, draft, published, updated_at, actor) VALUES(?, ?, ?, ?, ?)",
        )
        .bind(id, json, json, now, actor)
        .run(),
    );
  }
}

// Saves a whole draft. Returns null when another window saved first.
export async function saveDraft(
  db: D1Database,
  id: DocumentId,
  revision: number,
  draft: unknown,
  actor: string,
): Promise<DocumentRow | null> {
  let updated: { meta?: { changes?: number } };
  try {
    updated = await db
      .prepare(
        "UPDATE cms_documents SET draft = ?, revision = revision + 1, updated_at = ?, actor = ? WHERE id = ? AND revision = ?",
      )
      .bind(
        JSON.stringify(draft),
        new Date().toISOString(),
        actor,
        id,
        revision,
      )
      .run();
  } catch (error) {
    return conflictIfBusy(db, id, revision, error);
  }
  if (!(updated.meta?.changes ?? 0)) return null;
  return readRow(db, id);
}

// Uploads change one item. Read the draft, apply the change, and let the
// revision check reject the write if another window saved in between. The
// media row is registered in the same batch, so neither lands without the other.
export async function saveDocumentWithMedia<T>(
  db: D1Database,
  id: DocumentId,
  revision: number,
  actor: string,
  change: (draft: T) => T | null,
  registerMedia: D1PreparedStatement,
): Promise<DocumentRow | null> {
  const row = await readRow(db, id);
  if (!row || row.revision !== revision) return null;
  const draft = change(JSON.parse(row.draft));
  if (!draft) return null;
  try {
    const [saved] = await db.batch<DocumentRow>([
      db
        .prepare(
          "UPDATE cms_documents SET draft = ?, revision = revision + 1, updated_at = ?, actor = ? WHERE id = ? AND revision = ? RETURNING draft, published, revision, published_at",
        )
        .bind(
          JSON.stringify(draft),
          new Date().toISOString(),
          actor,
          id,
          revision,
        ),
      registerMedia,
    ]);
    return saved.results[0] ?? null;
  } catch (error) {
    return conflictIfBusy(db, id, revision, error);
  }
}

// Publishing is this one write: the public pages read the published column.
// `before` runs once the revision is confirmed, e.g. to keep a copy of what
// the publication replaces.
export async function publishDocument(
  db: D1Database,
  id: DocumentId,
  revision: number,
  actor: string,
  before?: (row: DocumentRow) => Promise<void>,
): Promise<DocumentRow | null> {
  const row = await readRow(db, id);
  if (!row || row.revision !== revision) return null;
  await before?.(row);
  const now = new Date().toISOString();
  try {
    return await db
      .prepare(
        "UPDATE cms_documents SET published = ?, published_at = ?, updated_at = ?, actor = ? WHERE id = ? AND revision = ? RETURNING draft, published, revision, published_at",
      )
      .bind(publishable(row.draft), now, now, actor, id, revision)
      .first<DocumentRow>();
  } catch (error) {
    return conflictIfBusy(db, id, revision, error);
  }
}

export async function readPublishedJson(
  db: D1Database,
  id: DocumentId,
  empty: unknown = [],
) {
  const row = await db
    .prepare("SELECT published FROM cms_documents WHERE id = ?")
    .bind(id)
    .first<{ published: string | null }>();
  return row?.published == null ? empty : JSON.parse(row.published);
}

// Uploaded media, for checking that a saved draft only points at real files.
export interface MediaRow {
  id: string;
  width: number;
  height: number;
  variants: string;
}
export async function uploadedMedia(db: D1Database) {
  const uploaded = await d1Retry(() =>
    db
      .prepare("SELECT id, width, height, variants FROM cms_media")
      .all<MediaRow>(),
  );
  return new Map((uploaded.results ?? []).map((row) => [row.id, row]));
}
export const sameMedia = (
  media: MediaRow | undefined,
  item: { width: number; height: number; variants: unknown },
) =>
  !!media &&
  media.width === item.width &&
  media.height === item.height &&
  media.variants === JSON.stringify(item.variants);
export async function uploadedClips(db: D1Database) {
  const uploaded = await d1Retry(() =>
    db.prepare("SELECT id FROM cms_clips").all<{
      id: string;
    }>(),
  );
  return new Set((uploaded.results ?? []).map((row) => row.id));
}
export const clipMatches = (
  clips: Set<string>,
  clip: { id: string; src: string } | null | undefined,
) => !clip || (clips.has(clip.id) && clip.src === `/media/${clip.id}/clip.mp4`);

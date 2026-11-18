// The content a static release is built from: WIP's published documents, frozen.
export { mediaKeysIn } from "./image.ts";

// Each document is either a list of items or a single object (e.g. a homepage).
export type DocumentKind = "list" | "object";
export type DocumentKinds = Record<string, DocumentKind>;

export interface Snapshot<Id extends string = string> {
  version: 1;
  exportedAt: string;
  source: string;
  documents: Record<Id, unknown>;
}

const fits = (kind: DocumentKind, value: unknown) =>
  kind === "list"
    ? Array.isArray(value)
    : !!value && typeof value === "object" && !Array.isArray(value);
const empty = (kind: DocumentKind) => (kind === "list" ? [] : {});

export function parseSnapshot<Id extends string>(
  value: unknown,
  kinds: Record<Id, DocumentKind>,
): Snapshot<Id> {
  const snapshot = value as Partial<Snapshot<Id>>;
  if (!snapshot || snapshot.version !== 1 || !snapshot.documents)
    throw new Error("The release snapshot has an unknown format.");
  for (const [id, kind] of Object.entries(kinds) as [Id, DocumentKind][])
    if (!fits(kind, snapshot.documents[id]))
      throw new Error(`The release snapshot has no ${id}.`);
  return snapshot as Snapshot<Id>;
}

// Rows from `SELECT id, published FROM cms_documents`. A document WIP never
// published is empty, exactly as the live pages treat it.
export function snapshotFromRows<Id extends string>(
  rows: { id: string; published: string | null }[],
  kinds: Record<Id, DocumentKind>,
  source: string,
  exportedAt = new Date().toISOString(),
): Snapshot<Id> {
  const documents = Object.fromEntries(
    (Object.entries(kinds) as [Id, DocumentKind][]).map(([id, kind]) => {
      const row = rows.find((item) => item.id === id);
      const value =
        row?.published == null ? empty(kind) : JSON.parse(row.published);
      if (!fits(kind, value))
        throw new Error(
          `WIP's published ${id} is not ${kind === "list" ? "a list" : "an object"}.`,
        );
      return [id, value];
    }),
  ) as Record<Id, unknown>;
  return { version: 1, exportedAt, source, documents };
}

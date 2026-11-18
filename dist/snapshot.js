// The content a static release is built from: WIP's published documents, frozen.
export { mediaKeysIn } from "./image.js";
const fits = (kind, value) => kind === "list"
    ? Array.isArray(value)
    : !!value && typeof value === "object" && !Array.isArray(value);
const empty = (kind) => (kind === "list" ? [] : {});
export function parseSnapshot(value, kinds) {
    const snapshot = value;
    if (!snapshot || snapshot.version !== 1 || !snapshot.documents)
        throw new Error("The release snapshot has an unknown format.");
    for (const [id, kind] of Object.entries(kinds))
        if (!fits(kind, snapshot.documents[id]))
            throw new Error(`The release snapshot has no ${id}.`);
    return snapshot;
}
// Rows from `SELECT id, published FROM cms_documents`. A document WIP never
// published is empty, exactly as the live pages treat it.
export function snapshotFromRows(rows, kinds, source, exportedAt = new Date().toISOString()) {
    const documents = Object.fromEntries(Object.entries(kinds).map(([id, kind]) => {
        const row = rows.find((item) => item.id === id);
        const value = row?.published == null ? empty(kind) : JSON.parse(row.published);
        if (!fits(kind, value))
            throw new Error(`WIP's published ${id} is not ${kind === "list" ? "a list" : "an object"}.`);
        return [id, value];
    }));
    return { version: 1, exportedAt, source, documents };
}

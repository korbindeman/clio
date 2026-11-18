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
export declare const d1Busy: (error: unknown) => boolean;
export declare function d1Retry<T>(op: () => Promise<T>): Promise<T>;
export declare function publishable(draft: string): string;
export declare const visibleItems: typeof publishable;
export declare const documentMeta: (row: DocumentRow) => DocumentMeta;
export declare function readRow(db: D1Database, id: DocumentId): Promise<DocumentRow | null>;
export declare function initializeDocuments(db: D1Database, documents: Record<DocumentId, unknown>, actor: string): Promise<void>;
export declare function saveDraft(db: D1Database, id: DocumentId, revision: number, draft: unknown, actor: string): Promise<DocumentRow | null>;
export declare function saveDocumentWithMedia<T>(db: D1Database, id: DocumentId, revision: number, actor: string, change: (draft: T) => T | null, registerMedia: D1PreparedStatement): Promise<DocumentRow | null>;
export declare function publishDocument(db: D1Database, id: DocumentId, revision: number, actor: string, before?: (row: DocumentRow) => Promise<void>): Promise<DocumentRow | null>;
export declare function readPublishedJson(db: D1Database, id: DocumentId, empty?: unknown): Promise<any>;
export interface MediaRow {
    id: string;
    width: number;
    height: number;
    variants: string;
}
export declare function uploadedMedia(db: D1Database): Promise<Map<string, MediaRow>>;
export declare const sameMedia: (media: MediaRow | undefined, item: {
    width: number;
    height: number;
    variants: unknown;
}) => boolean;
export declare function uploadedClips(db: D1Database): Promise<Set<string>>;
export declare const clipMatches: (clips: Set<string>, clip: {
    id: string;
    src: string;
} | null | undefined) => boolean;

export { mediaKeysIn } from "./image.ts";
export type DocumentKind = "list" | "object";
export type DocumentKinds = Record<string, DocumentKind>;
export interface Snapshot<Id extends string = string> {
    version: 1;
    exportedAt: string;
    source: string;
    documents: Record<Id, unknown>;
}
export declare function parseSnapshot<Id extends string>(value: unknown, kinds: Record<Id, DocumentKind>): Snapshot<Id>;
export declare function snapshotFromRows<Id extends string>(rows: {
    id: string;
    published: string | null;
}[], kinds: Record<Id, DocumentKind>, source: string, exportedAt?: string): Snapshot<Id>;

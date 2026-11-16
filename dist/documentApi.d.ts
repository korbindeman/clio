import type { APIRoute } from "astro";
import type { z } from "zod";
import { type DocumentRow } from "./store.ts";
export interface EditableDocument<T> {
    draft: T;
    revision: number;
    publishedAt: string | null;
    hasChanges: boolean;
}
export interface DocumentDefinition<T> {
    id: string;
    schema: z.ZodType<T>;
    seed: T;
    maxBytes?: number;
}
export declare function toEditable<T>(doc: DocumentDefinition<T>, row: DocumentRow): EditableDocument<T>;
export declare function readDocument<T>(doc: DocumentDefinition<T>, actor: string): Promise<EditableDocument<T>>;
export declare function documentRoutes<T>(doc: DocumentDefinition<T>): {
    GET: APIRoute;
    PUT: APIRoute;
};
export declare function publishRoute(documents: DocumentDefinition<any>[]): APIRoute;

import { type DocumentKind } from "../snapshot.ts";
export interface ReleaseOptions {
    documents: Record<string, DocumentKind>;
    buckets: {
        local: string;
        wip: string;
    };
    requiredPages: string[];
    buildEnv?: Record<string, string>;
    files?: Record<string, string>;
    args?: string[];
}
export declare function release(options: ReleaseOptions): Promise<void>;

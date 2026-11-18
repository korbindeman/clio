export declare function isrMatch(path: string, patterns: readonly string[]): boolean;
export declare function isrCacheKey(url: URL, version: string): string;
export interface IsrCache {
    match(key: string): Promise<Response | undefined>;
    put(key: string, response: Response): Promise<void>;
}
export declare function isrResponse(request: Request, version: () => Promise<string>, cache: IsrCache | undefined, render: () => Promise<Response>): Promise<Response>;
export declare function contentVersion(db: D1Database): Promise<string>;
export declare function edgeCache(): IsrCache | undefined;

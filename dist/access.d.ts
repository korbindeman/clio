export declare function publicPreviewPath(path: string): boolean;
export declare function loginDestination(value: string | null, fallback?: string): string;
export declare function previewResponse(request: Request, authenticate: () => Promise<string | null>, next: () => Promise<Response>): Promise<Response>;

export declare function serveMedia(request: Request, bucket: R2Bucket, key: string, cacheControl: string): Promise<Response>;
export declare const IMMUTABLE = "public, max-age=31536000, immutable";
export interface Buckets {
    CMS_MEDIA: R2Bucket;
    CMS_ORIGINALS: R2Bucket;
}
export declare function putMedia(buckets: Buckets, key: string, body: ReadableStream | ArrayBuffer, contentType: string): Promise<void>;
export declare function deleteMedia(buckets: Buckets, keys: string[]): Promise<void>;

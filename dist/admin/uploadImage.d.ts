export declare const IMAGE_TYPES = "image/jpeg,image/png,image/webp";
export declare function uploadImage<D>(path: string, file: File, revision: number, progress?: (value: string) => void, fields?: Record<string, string>): Promise<D>;

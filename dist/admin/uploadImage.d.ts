export declare const IMAGE_TYPES = "image/*,.heic,.heif,.avif";
export declare const isImageFile: (file: File) => boolean;
export declare function uploadImage<D>(path: string, file: File, revision: number, progress?: (value: string) => void, fields?: Record<string, string>): Promise<D>;

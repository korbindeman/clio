export declare const MAX_UPLOAD: number;
export declare function readLimited(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null>;
export declare function inspectImage(bytes: Uint8Array, types?: string[]): import("image-size/types/interface").ISizeCalculationResult;
export interface UploadObject {
    key: string;
    file: File;
    type: string;
}
export declare function readImageForm(form: FormData, id: string): Promise<{
    width: number;
    height: number;
    variants: {
        width: number;
        src: string;
    }[];
    placeholder: string;
    originalKey: string;
    objects: UploadObject[];
}>;
export declare const MAX_CLIP: number;
export declare function inspectClip(bytes: Uint8Array): void;
export declare function hasAudioTrack(bytes: Uint8Array): boolean;
export declare const MAX_AUDIO: number;
export declare function inspectAudio(bytes: Uint8Array): void;

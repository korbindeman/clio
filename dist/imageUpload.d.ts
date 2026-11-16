import type { Image } from "./image.ts";
import { type DocumentRow } from "./store.ts";
export interface ImageUploadResult {
    row: DocumentRow;
    image: Image;
    form: FormData;
}
export declare function receiveImageUpload(request: Request, documentId: string, actor: string, change: (draft: any, image: Image, form: FormData) => unknown | null): Promise<ImageUploadResult | Response>;

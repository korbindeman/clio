import { mediaKeysIn } from "../image.ts";
export { mediaKeysIn };
export declare const MAX_ASSET_BYTES: number;
export declare function listFiles(dir: string): string[];
export declare function referencedMedia(dir: string): Set<string>;
export declare function verifyRelease(dir: string, requiredPages: string[]): string[];

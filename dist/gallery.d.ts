export declare function justifiedLayout(ratios: number[], width: number, gap: number, targetHeight?: number): {
    width: number;
    height: number;
}[];
export declare function setupGallery(gallery: HTMLElement, ratios: number[], targetHeight?: (width: number) => number): () => void;

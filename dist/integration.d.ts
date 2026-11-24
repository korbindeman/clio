import type { AstroIntegration } from "astro";
import type { DocumentKind } from "./snapshot.ts";
export interface CmsOptions {
    appName: string;
    cookiePrefix: string;
    documents: Record<string, DocumentKind>;
    pages?: string;
    release?: boolean;
    isr?: string[];
    locale?: "en" | "nl";
}
export declare const DEV_ROUTES: {
    pattern: string;
    entrypoint: string;
}[];
export declare const CORE_ROUTES: {
    pattern: string;
    entrypoint: string;
}[];
export declare function cmsRoutes(pages: string | undefined, root?: string): {
    pattern: string;
    entrypoint: string;
}[];
export default function cms(options: CmsOptions): AstroIntegration;

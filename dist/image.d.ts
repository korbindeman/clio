import { z } from "zod";
export declare const mediaId: z.ZodString;
export declare const variantSchema: z.ZodObject<{
    width: z.ZodNumber;
    src: z.ZodString;
}, z.core.$strip>;
export declare const placeholderSchema: z.ZodString;
export declare const imageFields: {
    id: z.ZodString;
    width: z.ZodNumber;
    height: z.ZodNumber;
    variants: z.ZodArray<z.ZodObject<{
        width: z.ZodNumber;
        src: z.ZodString;
    }, z.core.$strip>>;
    placeholder: z.ZodString;
};
export declare const imageSchema: z.ZodObject<{
    id: z.ZodString;
    width: z.ZodNumber;
    height: z.ZodNumber;
    variants: z.ZodArray<z.ZodObject<{
        width: z.ZodNumber;
        src: z.ZodString;
    }, z.core.$strip>>;
    placeholder: z.ZodString;
}, z.core.$strip>;
export type Image = z.infer<typeof imageSchema>;
export declare function imageProps(image: {
    variants: {
        width: number;
        src: string;
    }[];
}): {
    src: string;
    thumbnail: string;
    srcset: string;
};
export declare function mediaKeysIn(text: string): Set<string>;

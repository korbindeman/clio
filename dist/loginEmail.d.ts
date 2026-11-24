export declare function describeClient(userAgent: string | null | undefined): string;
export type Locale = "en" | "nl";
export declare function loginEmail(url: string, client?: string, otp?: string, locale?: Locale): {
    subject: string;
    text: string;
    html: string;
};

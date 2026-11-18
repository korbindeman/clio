export declare function describeClient(userAgent: string | null | undefined): string;
export declare function loginEmail(url: string, client?: string, otp?: string): {
    subject: string;
    text: string;
    html: string;
};

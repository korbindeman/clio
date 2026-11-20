// The emailed link opens the sign-in page, which asks for one tap before it
// calls the verify endpoint. Mail scanners (Gmail, Outlook) open links as soon
// as a message arrives; a link that signed in on that first visit was used up
// by the scanner, and signing in revokes the code, so Ele's code was rejected
// even when she typed it at once.
export function approvalPage(verifyUrl, baseURL) {
    const verify = new URL(verifyUrl);
    const page = new URL("/login/", baseURL);
    page.searchParams.set("approve", `${verify.pathname}${verify.search}`);
    return page.toString();
}
// The verify path the sign-in page may follow, or null for anything else.
export function approvalTarget(value) {
    if (!value)
        return null;
    try {
        const url = new URL(value, "https://site.invalid");
        if (url.origin !== "https://site.invalid")
            return null;
        if (url.pathname !== "/api/auth/magic-link/verify")
            return null;
        if (!url.searchParams.get("token"))
            return null;
        return `${url.pathname}${url.search}`;
    }
    catch {
        return null;
    }
}

export function describeClient(userAgent) {
    if (!userAgent?.trim())
        return "";
    const ua = userAgent;
    const browser = /Edg\//.test(ua)
        ? "Edge"
        : /Chrome\/|CriOS\//.test(ua)
            ? "Chrome"
            : /Firefox\/|FxiOS\//.test(ua)
                ? "Firefox"
                : /Safari\//.test(ua) && !/Chrome\/|CriOS\/|Android/.test(ua)
                    ? "Safari"
                    : "a browser";
    const os = /iPhone|iPad|iPod/.test(ua)
        ? "iOS"
        : /Android/.test(ua)
            ? "Android"
            : /Mac OS X|Macintosh/.test(ua)
                ? "macOS"
                : /Windows/.test(ua)
                    ? "Windows"
                    : /Linux/.test(ua)
                        ? "Linux"
                        : "";
    return os ? `${browser} on ${os}` : browser;
}
function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}
export function loginEmail(url, client = "", otp = "") {
    const request = client
        ? `A sign-in was requested from ${client}.`
        : "A sign-in was requested for this email.";
    const code = otp ? `Your sign-in code is ${otp}.\n\n` : "";
    const htmlCode = otp
        ? `<p>Your sign-in code is <strong>${escapeHtml(otp)}</strong>.</p>`
        : "";
    return {
        subject: "Approve this sign-in",
        text: `${request}\n\n${code}Or approve this request:\n${url}\n\nThe code and link expire in 10 minutes and can be used once. If you did not request this, ignore this email.`,
        html: `<p>${escapeHtml(request)}</p>${htmlCode}<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 18px;border:1px solid #222;color:#222;text-decoration:none">Approve</a></p><p style="color:#757575;font-size:14px">The code and link expire in 10 minutes and can be used once. If you did not request this, ignore this email.</p>`,
    };
}

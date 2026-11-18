// Password hashing for editor sign-in: PBKDF2-SHA-256 through Web Crypto,
// which Workers run natively (a pure-JS scrypt would spend the request's CPU
// budget). Stored as "pbkdf2-sha256$<iterations>$<salt>$<hash>", base64url.
// 100,000 iterations is the most Workers allow.
const ITERATIONS = 100_000;
const PREFIX = "pbkdf2-sha256";
export const MIN_PASSWORD_LENGTH = 12;
function encode(bytes) {
    let binary = "";
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return btoa(binary)
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "");
}
function decode(value) {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
async function derive(password, salt, iterations) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
    return new Uint8Array(bits);
}
export async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await derive(password, salt, ITERATIONS);
    return `${PREFIX}$${ITERATIONS}$${encode(salt)}$${encode(hash)}`;
}
export async function verifyPassword({ hash, password, }) {
    const [prefix, rounds, salt, expected] = hash.split("$");
    const iterations = Number(rounds);
    if (prefix !== PREFIX ||
        !Number.isInteger(iterations) ||
        iterations < 1 ||
        iterations > ITERATIONS ||
        !salt ||
        !expected)
        return false;
    const actual = await derive(password, decode(salt), iterations);
    const wanted = decode(expected);
    if (actual.length !== wanted.length)
        return false;
    let difference = 0;
    for (let i = 0; i < actual.length; i++)
        difference |= actual[i] ^ wanted[i];
    return difference === 0;
}

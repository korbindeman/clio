// Sets an editor's sign-in password. Run it from the site's folder:
//
//   bun node_modules/@korbindeman/clio/dist/scripts/password.js <auth-d1-name> [--local]
//
// It asks for the email and the password (the password is not shown while you
// type, and can also be piped in), hashes the password and writes only the hash
// to the sign-in database with wrangler. The address must also be in the
// site's editors list (ADMIN_EMAILS) for the sign-in to be accepted.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { MIN_PASSWORD_LENGTH, hashPassword } from "../password.ts";

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

// The SQL that gives `email` this password hash, creating the editor if they
// have never signed in. Any earlier password is replaced.
export function passwordSql(email: string, hash: string, now = new Date()) {
  const at = quote(now.toISOString());
  const address = quote(email);
  const user = `(SELECT id FROM cms_auth_user WHERE email = ${address})`;
  return [
    `INSERT INTO cms_auth_user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (${quote(crypto.randomUUID())}, '', ${address}, 1, ${at}, ${at}) ON CONFLICT(email) DO NOTHING;`,
    `DELETE FROM cms_auth_account WHERE providerId = 'credential' AND userId = ${user};`,
    `INSERT INTO cms_auth_account (id, accountId, providerId, userId, password, createdAt, updatedAt) SELECT ${quote(crypto.randomUUID())}, id, 'credential', id, ${quote(hash)}, ${at}, ${at} FROM cms_auth_user WHERE email = ${address};`,
    // Signing in elsewhere with the old password stops working at once.
    `DELETE FROM cms_auth_session WHERE userId = ${user};`,
  ].join("\n");
}

async function ask(question: string, hidden = false): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY) {
    const lines = createInterface({ input });
    for await (const line of lines) {
      lines.close();
      return line;
    }
    return "";
  }
  process.stdout.write(question);
  if (!hidden) {
    const lines = createInterface({ input, output: process.stdout, terminal: false });
    for await (const line of lines) {
      lines.close();
      return line;
    }
    return "";
  }
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve) => {
    let value = "";
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") {
          input.setRawMode(false);
          input.pause();
          input.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") process.exit(130);
        if (char === "\u007f") value = value.slice(0, -1);
        else value += char;
      }
    };
    input.on("data", onData);
  });
}

async function main() {
  const [database, ...flags] = process.argv.slice(2);
  if (!database || database.startsWith("-"))
    throw new Error("Usage: password.js <auth-d1-name> [--local]");
  const email = (process.env.CLIO_EMAIL ?? (await ask("Email: ")))
    .trim()
    .toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error("Enter a valid email.");
  const password = process.env.CLIO_PASSWORD ?? (await ask("Password: ", true));
  if (password.length < MIN_PASSWORD_LENGTH)
    throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  const dir = mkdtempSync(join(tmpdir(), "clio-password-"));
  const file = join(dir, "password.sql");
  try {
    writeFileSync(file, passwordSql(email, await hashPassword(password)), {
      mode: 0o600,
    });
    execFileSync(
      process.execPath,
      [
        "node_modules/wrangler/bin/wrangler.js",
        "d1",
        "execute",
        database,
        flags.includes("--local") ? "--local" : "--remote",
        "--file",
        file,
      ],
      { stdio: "inherit" },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`Password set for ${email}. Earlier sign-ins were signed out.`);
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });

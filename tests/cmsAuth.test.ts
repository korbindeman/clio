import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  createCmsAuth,
  SESSION_SECONDS,
  authenticate,
  sameOrigin,
  approvedCallback,
} from "../src/auth.ts";
import { describeClient, loginEmail } from "../src/loginEmail.ts";
import { approvalTarget } from "../src/approval.ts";

// The emailed link opens /login/?approve=…; the page then follows the verify
// link. Tests keep the verify link as `url` and the emailed one as `emailed`.
function verifyLink(emailed: string) {
  const page = new URL(emailed);
  const target = approvalTarget(page.searchParams.get("approve"));
  if (page.pathname !== "/login/" || !target)
    throw new Error(`Not a sign-in page link: ${emailed}`);
  return new URL(target, page.origin).toString();
}

const origin = "https://portfolio.example";
const email = "editor@example.com";
function setup() {
  const database = new DatabaseSync(":memory:");
  database.exec(
    readFileSync(
      new URL("../migrations/0001_cms.sql", import.meta.url),
      "utf8",
    ),
  );
  // Sign-up is disabled: each site adds its editors in a migration.
  database
    .prepare(
      "INSERT INTO cms_auth_user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('editor', 'Editor', ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
    )
    .run(email);
  const sent: {
    email: string;
    url: string;
    emailed?: string;
    otp?: string;
    request?: Request;
  }[] = [];
  let failedDelivery = false;
  const auth = createCmsAuth({
    appName: "Portfolio",
    cookiePrefix: "site",
    database,
    baseURL: origin,
    secret: "test-only-long-secret-should-never-be-used-in-production",
    adminEmails: email,
    reserveLink: async (address) =>
      database
        .prepare(
          `INSERT INTO cms_auth_email_limit (email,nextSendAt) VALUES (?,?) ON CONFLICT(email) DO UPDATE SET nextSendAt=excluded.nextSendAt WHERE nextSendAt <= ?`,
        )
        .run(address, Date.now() + 60000, Date.now()).changes === 1,
    revokeLinks: async (address) => {
      database
        .prepare(
          "DELETE FROM cms_auth_verification WHERE value LIKE ? OR identifier = ?",
        )
        .run(`%"email":"${address}"%`, `sign-in-otp-${address}`);
    },
    sendLink: async (address, url, request, otp) => {
      if (failedDelivery) throw new Error("Delivery failed");
      sent.push({ email: address, url: verifyLink(url), emailed: url, otp, request });
    },
  });
  const request = (
    path: string,
    body?: object,
    cookie = "",
    ip = "192.0.2.1",
    from: string | null = origin,
  ) =>
    auth.handler(
      new Request(`${origin}/api/auth/${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          ...(from ? { Origin: from } : {}),
          "Content-Type": "application/json",
          "cf-connecting-ip": ip,
          Cookie: cookie,
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  const send = () =>
    request("sign-in/magic-link", {
      email,
      callbackURL: "/login/?approved=1&next=/admin/",
      errorCallbackURL: "/login/",
    });
  const tokenOf = (url: string) => new URL(url).searchParams.get("token")!;
  const verify = (token: string, from: string | null = null) =>
    request(
      `magic-link/verify?token=${token}&callbackURL=${encodeURIComponent("/login/?approved=1")}&errorCallbackURL=${encodeURIComponent("/login/")}`,
      undefined,
      "",
      "192.0.2.1",
      from,
    );
  return {
    database,
    auth,
    sent,
    request,
    send,
    verify,
    tokenOf,
    failDelivery: () => {
      failedDelivery = true;
    },
  };
}

function sessionCookie(response: Response) {
  return response.headers
    .getSetCookie()
    .find((value) => value.startsWith("__Secure-site.session_token="))!;
}

test("magic link creates a verified session, is one-use, and sign-out revokes it", async () => {
  const f = setup();
  assert.equal((await f.send()).status, 200);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].email, email);
  const token = f.tokenOf(f.sent[0].url);
  assert.match(token, /^[a-zA-Z]{32}$/);
  assert.match(f.sent[0].url, /\/api\/auth\/magic-link\/verify\?/);
  // A mail scanner opening the emailed link only loads the sign-in page.
  assert.match(f.sent[0].emailed!, /^https:\/\/[^/]+\/login\/\?approve=/);
  assert.equal(new URL(f.sent[0].emailed!).searchParams.get("token"), null);
  assert.equal(
    new URL(f.sent[0].url).searchParams.get("callbackURL"),
    "/login/?approved=1&next=%2Fadmin%2F",
  );
  const stored = f.database
    .prepare(
      "SELECT identifier, value FROM cms_auth_verification WHERE value LIKE ?",
    )
    .get(`%"email":"${email}"%`)!;
  assert.ok(!String(stored.identifier).includes(token));
  assert.ok(!String(stored.value).includes(token));
  assert.match(String(stored.value), new RegExp(email));
  assert.equal(
    f.database.prepare("SELECT count(*) n FROM cms_auth_verification").get()!.n,
    2,
  );
  const response = await f.verify(token);
  assert.equal(response.status, 302, await response.clone().text());
  assert.match(response.headers.get("location") ?? "", /approved=1/);
  const setCookie = sessionCookie(response);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Path=\//i);
  // One week, not extended on use.
  assert.match(setCookie, new RegExp(`Max-Age=${SESSION_SECONDS}(;|$)`, "i"));
  const expiresAt = Date.parse(
    String(
      f.database.prepare("SELECT expiresAt FROM cms_auth_session").get()!
        .expiresAt,
    ),
  );
  assert.ok(Math.abs(expiresAt - Date.now() - SESSION_SECONDS * 1000) < 60000);
  const cookie = setCookie.split(";")[0];
  assert.equal(
    await authenticate(
      new Request(origin, { headers: { Cookie: cookie } }),
      f.auth,
      email,
    ),
    email,
  );
  assert.equal(
    await authenticate(
      new Request(origin, { headers: { Cookie: cookie } }),
      f.auth,
      "other@example.com",
    ),
    null,
  );
  const replay = await f.verify(token);
  assert.equal(replay.status, 302);
  assert.match(replay.headers.get("location") ?? "", /error=INVALID_TOKEN/);
  assert.equal(sessionCookie(replay), undefined);
  const logout = await f.request("sign-out", {}, cookie);
  assert.equal(logout.status, 200);
  assert.equal(
    await authenticate(
      new Request(origin, { headers: { Cookie: cookie } }),
      f.auth,
      email,
    ),
    null,
  );
  f.database.close();
});

test("unknown addresses cannot receive links or register; forged cookies and Access headers fail", async () => {
  const f = setup();
  assert.equal(
    (
      await f.request("sign-in/magic-link", {
        email: "stranger@example.com",
        callbackURL: "/login/?approved=1",
      })
    ).status,
    200,
  );
  assert.equal(f.sent.length, 0);
  assert.equal(
    f.database.prepare("SELECT count(*) n FROM cms_auth_verification").get()!.n,
    0,
  );
  assert.equal((await f.verify("notarealtokenvalueatallxxxxxxxx")).status, 302);
  assert.equal(
    f.database.prepare("SELECT count(*) n FROM cms_auth_user").get()!.n,
    1,
  );
  assert.equal(
    await authenticate(
      new Request(origin, {
        headers: {
          Cookie: "__Secure-site.session_token=forged",
          "Cf-Access-Jwt-Assertion": "forged",
          "Cf-Access-Authenticated-User-Email": email,
        },
      }),
      f.auth,
      email,
    ),
    null,
  );
  f.database.close();
});

test("expired links and expired sessions fail", async () => {
  const f = setup();
  await f.send();
  f.database.exec(
    "UPDATE cms_auth_verification SET expiresAt='2000-01-01T00:00:00.000Z'",
  );
  const expired = await f.verify(f.tokenOf(f.sent[0].url));
  assert.equal(expired.status, 302);
  assert.match(expired.headers.get("location") ?? "", /error=INVALID_TOKEN/);
  f.database.exec("DELETE FROM cms_auth_email_limit");
  await f.send();
  const response = await f.verify(f.tokenOf(f.sent[1].url));
  assert.equal(response.status, 302);
  const cookie = sessionCookie(response).split(";")[0];
  f.database.exec(
    "UPDATE cms_auth_session SET expiresAt='2000-01-01T00:00:00.000Z'",
  );
  assert.equal(
    await authenticate(
      new Request(origin, { headers: { Cookie: cookie } }),
      f.auth,
      email,
    ),
    null,
  );
  f.database.close();
});

test("a new link replaces the previous one; invalid tokens do not consume it", async () => {
  const f = setup();
  await f.send();
  const first = f.tokenOf(f.sent[0].url);
  assert.equal(
    (
      await f.request(
        "sign-in/magic-link",
        { email, callbackURL: "/login/?approved=1" },
        "",
        "192.0.2.2",
      )
    ).status,
    429,
  );
  assert.equal(f.sent.length, 1);
  const invalid = await f.verify("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(invalid.status, 302);
  assert.match(invalid.headers.get("location") ?? "", /error=INVALID_TOKEN/);
  f.database.exec("DELETE FROM cms_auth_email_limit");
  await f.send();
  assert.equal(f.sent.length, 2);
  const replaced = await f.verify(first);
  assert.match(replaced.headers.get("location") ?? "", /error=INVALID_TOKEN/);
  const fresh = await f.verify(f.tokenOf(f.sent[1].url));
  assert.equal(fresh.status, 302);
  assert.match(fresh.headers.get("location") ?? "", /approved=1/);
  assert.notEqual(
    (
      await f.request(
        "sign-in/magic-link",
        { email, callbackURL: "/login/?approved=1" },
        "",
        "192.0.2.3",
        "https://evil.example",
      )
    ).status,
    200,
  );
  for (let n = 0; n < 3; n++)
    await f.request(
      "sign-in/magic-link",
      { email: "stranger@example.com", callbackURL: "/login/?approved=1" },
      "",
      "192.0.2.4",
    );
  assert.equal(
    (
      await f.request(
        "sign-in/magic-link",
        { email: "stranger@example.com", callbackURL: "/login/?approved=1" },
        "",
        "192.0.2.4",
      )
    ).status,
    429,
  );
  assert.ok(
    Number(
      f.database.prepare("SELECT count(*) n FROM cms_auth_rate_limit").get()!.n,
    ) > 0,
  );
  f.database.close();
});

test("concurrent use of one link creates only one session", async () => {
  const f = setup();
  await f.send();
  const token = f.tokenOf(f.sent[0].url);
  const results = await Promise.all([f.verify(token), f.verify(token)]);
  assert.equal(
    results.filter(
      (r) =>
        r.status === 302 && /approved=1/.test(r.headers.get("location") ?? ""),
    ).length,
    1,
  );
  assert.equal(
    f.database.prepare("SELECT count(*) n FROM cms_auth_session").get()!.n,
    1,
  );
  f.database.close();
});

test("delivery failure does not report a sent link or create a session", async () => {
  const f = setup();
  f.failDelivery();
  assert.equal((await f.send()).status, 503);
  assert.equal(f.sent.length, 0);
  assert.equal(
    f.database.prepare("SELECT count(*) n FROM cms_auth_verification").get()!.n,
    0,
  );
  assert.equal(
    f.database.prepare("SELECT count(*) n FROM cms_auth_session").get()!.n,
    0,
  );
  f.database.close();
});

test("writes require a same-origin browser request", () => {
  const request = (from?: string, site?: string) =>
    new Request(`${origin}/api/auth/sign-out`, {
      method: "POST",
      headers: {
        ...(from ? { Origin: from } : {}),
        ...(site ? { "Sec-Fetch-Site": site } : {}),
      },
    });
  assert.equal(sameOrigin(request(origin, "same-origin")), true);
  assert.equal(sameOrigin(request()), false);
  assert.equal(sameOrigin(request("https://evil.example")), false);
  assert.equal(sameOrigin(request(origin, "cross-site")), false);
});

test("one email login works on live and WIP; sign-out revokes both", async () => {
  const f = setup();
  const shared = {
    database: f.database,
    secret: "test-only-shared-secret-never-used-in-production",
    adminEmails: email,
    cookieDomain: "portfolio.example",
    sendLink: async (address: string, url: string) => {
      f.sent.push({ email: address, url: verifyLink(url), emailed: url });
    },
    reserveLink: async () => true,
    revokeLinks: async () => {},
  };
  const live = createCmsAuth({
    appName: "Portfolio",
    cookiePrefix: "site",
    ...shared,
    baseURL: "https://portfolio.example",
  });
  const wip = createCmsAuth({
    appName: "Portfolio",
    cookiePrefix: "site",
    ...shared,
    baseURL: "https://wip.portfolio.example",
  });
  const post = (path: string, body: object, cookie = "") =>
    live.handler(
      new Request(`https://portfolio.example/api/auth/${path}`, {
        method: "POST",
        headers: {
          Origin: "https://portfolio.example",
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify(body),
      }),
    );
  assert.equal(
    (
      await post("sign-in/magic-link", {
        email,
        callbackURL: "/login/?approved=1",
      })
    ).status,
    200,
  );
  const token = f.tokenOf(f.sent[0].url);
  const login = await live.handler(
    new Request(
      `https://portfolio.example/api/auth/magic-link/verify?token=${token}&callbackURL=${encodeURIComponent("/login/?approved=1")}`,
    ),
  );
  assert.equal(login.status, 302);
  const setCookie = sessionCookie(login);
  assert.match(setCookie, /Domain=\.?portfolio\.example/i);
  const cookie = setCookie.split(";")[0];
  for (const auth of [live, wip])
    assert.equal(
      await authenticate(
        new Request("https://wip.portfolio.example", {
          headers: { Cookie: cookie },
        }),
        auth,
        email,
      ),
      email,
    );
  assert.equal((await post("sign-out", {}, cookie)).status, 200);
  for (const auth of [live, wip])
    assert.equal(
      await authenticate(
        new Request("https://wip.portfolio.example", {
          headers: { Cookie: cookie },
        }),
        auth,
        email,
      ),
      null,
    );
  f.database.close();
});

test("login callback stays on the sign-in page and login email names the browser", () => {
  assert.equal(
    approvedCallback("/login/?approved=1&next=/admin/video/"),
    "/login/?approved=1&next=%2Fadmin%2Fvideo%2F",
  );
  assert.equal(approvedCallback("https://evil.example/"), "/login/?approved=1");
  assert.equal(
    approvedCallback("/login/?next=https://evil.example"),
    "/login/?approved=1",
  );
  assert.equal(
    describeClient(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    ),
    "Chrome on macOS",
  );
  assert.equal(describeClient(""), "");
  const message = loginEmail(
    "https://portfolio.example/api/auth/magic-link/verify?token=abc",
    "Chrome on macOS",
    "482193",
  );
  assert.equal(message.subject, "Approve this sign-in");
  assert.match(message.text, /A sign-in was requested from Chrome on macOS/);
  assert.match(message.text, /Your sign-in code is 482193/);
  assert.match(message.html, /Your sign-in code is <strong>482193<\/strong>/);
  assert.match(message.html, />Approve</);
  assert.doesNotMatch(message.subject + message.text + message.html, /[·•]/);
  assert.doesNotMatch(
    message.subject + message.text + message.html,
    /[\u{1F300}-\u{1FAFF}]/u,
  );
});

test("email code creates a verified session, is one-use, and rejects guesses", async () => {
  const f = setup();
  assert.equal((await f.send()).status, 200);
  const otp = f.sent[0].otp;
  assert.match(otp ?? "", /^\d{6}$/);
  const stored = f.database
    .prepare(
      "SELECT identifier, value FROM cms_auth_verification WHERE identifier = ?",
    )
    .get(`sign-in-otp-${email}`)!;
  assert.ok(!String(stored.value).includes(otp!));
  const wrong = await f.request("sign-in/email-otp", {
    email,
    otp: "000000",
  });
  assert.notEqual(wrong.status, 200);
  assert.equal(sessionCookie(wrong), undefined);
  const response = await f.request("sign-in/email-otp", { email, otp });
  assert.equal(response.status, 200, await response.clone().text());
  const setCookie = sessionCookie(response);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Lax/i);
  const cookie = setCookie.split(";")[0];
  assert.equal(
    await authenticate(
      new Request(origin, { headers: { Cookie: cookie } }),
      f.auth,
      email,
    ),
    email,
  );
  const replay = await f.request("sign-in/email-otp", { email, otp });
  assert.notEqual(replay.status, 200);
  assert.equal(sessionCookie(replay), undefined);
  const link = await f.verify(f.tokenOf(f.sent[0].url));
  assert.equal(link.status, 302);
  assert.match(link.headers.get("location") ?? "", /error=INVALID_TOKEN/);
  assert.equal(
    (
      await f.request("sign-in/email-otp", {
        email: "stranger@example.com",
        otp: "123456",
      })
    ).status,
    400,
  );
  f.database.close();
});

test("five wrong codes invalidate the email code", async () => {
  const f = setup();
  await f.send();
  const otp = f.sent[0].otp!;
  for (let n = 0; n < 5; n++) {
    const guess = await f.request("sign-in/email-otp", {
      email,
      otp: "000000",
    });
    assert.notEqual(guess.status, 200);
  }
  const locked = await f.request("sign-in/email-otp", { email, otp });
  assert.notEqual(locked.status, 200);
  assert.equal(sessionCookie(locked), undefined);
  f.database.close();
});

test("an editor signs in with a password set by the password script", async () => {
  const { passwordSql } = await import("../src/scripts/password.ts");
  const { hashPassword } = await import("../src/password.ts");
  const f = setup();
  const hash = await hashPassword("a long enough password");
  assert.match(hash, /^pbkdf2-sha256\$100000\$/);
  assert.ok(!hash.includes("a long enough password"));
  f.database.exec(passwordSql(email, hash));
  // Running it again replaces the password instead of adding a second one.
  f.database.exec(passwordSql(email, hash));
  assert.equal(
    f.database
      .prepare("SELECT COUNT(*) AS n FROM cms_auth_account WHERE providerId = 'credential'")
      .get()!.n,
    1,
  );
  const wrong = await f.request("sign-in/email", { email, password: "not the password" });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get("set-cookie"), null);
  const right = await f.request("sign-in/email", {
    email: ` ${email.toUpperCase()} `,
    password: "a long enough password",
  });
  assert.equal(right.status, 200);
  assert.match(right.headers.get("set-cookie") ?? "", /session_token=/);
});

test("a password set for an editor already there but unverified lets them into the admin", async () => {
  const { passwordSql } = await import("../src/scripts/password.ts");
  const { hashPassword } = await import("../src/password.ts");
  const f = setup();
  // They asked for a code once and never used it: their row is unverified.
  f.database.prepare("UPDATE cms_auth_user SET emailVerified = 0 WHERE email = ?").run(email);
  const earlier = f.database.prepare("SELECT id FROM cms_auth_user WHERE email = ?").get(email)!.id;
  f.database.exec(passwordSql(email, await hashPassword("a long enough password")));
  const row = f.database.prepare("SELECT id, emailVerified FROM cms_auth_user WHERE email = ?").get(email)!;
  assert.equal(row.id, earlier, "the same editor, not a second one");
  assert.equal(Number(row.emailVerified), 1);
  const response = await f.request("sign-in/email", { email, password: "a long enough password" });
  assert.equal(response.status, 200);
  const cookie = sessionCookie(response).split(";")[0];
  assert.equal(
    await authenticate(new Request(origin, { headers: { Cookie: cookie } }), f.auth, email),
    email,
    "the session is accepted by the admin",
  );
});

test("password sign-in refuses addresses outside the editors list, and sign-up stays closed", async () => {
  const { passwordSql } = await import("../src/scripts/password.ts");
  const { hashPassword } = await import("../src/password.ts");
  const f = setup();
  const stranger = "stranger@example.com";
  f.database.exec(passwordSql(stranger, await hashPassword("a long enough password")));
  const response = await f.request("sign-in/email", {
    email: stranger,
    password: "a long enough password",
  }, "", "192.0.2.9");
  assert.equal(response.status, 401);
  const signUp = await f.request("sign-up/email", {
    email: "new@example.com",
    password: "a long enough password",
    name: "New",
  }, "", "192.0.2.10");
  assert.notEqual(signUp.status, 200);
  const reset = await f.request("request-password-reset", { email }, "", "192.0.2.11");
  assert.notEqual(reset.status, 200);
});

test("password guesses are rate limited", async () => {
  const f = setup();
  const statuses: number[] = [];
  for (let i = 0; i < 7; i++)
    statuses.push(
      (await f.request("sign-in/email", { email, password: `guess number ${i}` }, "", "192.0.2.20")).status,
    );
  assert.ok(statuses.includes(429), statuses.join(","));
});

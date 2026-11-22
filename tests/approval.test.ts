import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalPage, approvalTarget } from "../src/approval.ts";

const verify =
  "https://site.example/api/auth/magic-link/verify?token=abc&callbackURL=%2Flogin%2F%3Fapproved%3D1&errorCallbackURL=%2Flogin%2F";

test("the emailed link opens the sign-in page instead of signing in", () => {
  const page = new URL(approvalPage(verify, "https://site.example"));
  assert.equal(page.pathname, "/login/");
  assert.equal(
    approvalTarget(page.searchParams.get("approve")),
    "/api/auth/magic-link/verify?token=abc&callbackURL=%2Flogin%2F%3Fapproved%3D1&errorCallbackURL=%2Flogin%2F",
  );
});

test("the sign-in page only follows a same-site verify link", () => {
  assert.equal(approvalTarget(null), null);
  assert.equal(approvalTarget("https://evil.example/api/auth/magic-link/verify?token=a"), null);
  assert.equal(approvalTarget("//evil.example/api/auth/magic-link/verify?token=a"), null);
  assert.equal(approvalTarget("/admin/"), null);
  assert.equal(approvalTarget("/api/auth/magic-link/verify"), null);
  assert.equal(approvalTarget("javascript:alert(1)"), null);
});

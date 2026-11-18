import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compile } from "svelte/compiler";

const source = readFileSync("src/admin/SignIn.svelte", "utf8");

test("the sign-in code input keeps the literal [0-9]{6} pattern", () => {
  for (const generate of ["client", "server"] as const) {
    const { code } = compile(source, { generate, filename: "SignIn.svelte" }).js;
    assert.ok(code.includes("[0-9]{6}"), `${generate} output keeps {6}`);
    assert.ok(!code.includes("[0-9]6"), `${generate} output lost the quantifier`);
  }
});

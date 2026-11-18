import assert from "node:assert/strict";
import { test } from "node:test";
import { previewResponse, loginDestination } from "../src/access.ts";

test("WIP denies anonymous static pages and media before serving assets", async () => {
  for (const path of [
    "/",
    "/photographs/",
    "/drinks/hashi/",
    "/media/photo/320.webp",
    "/_astro/photo.webp",
    "/_astro/film.mp4",
  ]) {
    let served = false;
    const response = await previewResponse(
      new Request(`https://wip.example${path}`),
      async () => null,
      async () => {
        served = true;
        return new Response("private");
      },
    );
    assert.equal(response.status, 401, path);
    assert.equal(served, false, path);
  }
});
test("WIP login assets and the deployment marker work without a session", async () => {
  for (const path of [
    "/login/",
    "/api/auth/magic-link/verify",
    "/_astro/login.js",
    "/_astro/font.woff2",
    "/publication.json",
  ]) {
    const response = await previewResponse(
      new Request(`https://wip.example${path}`),
      async () => {
        throw new Error("unexpected auth");
      },
      async () => new Response("public"),
    );
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
  }
});
test("WIP returns users to the selected page and never redirects outside the site", async () => {
  const response = await previewResponse(
    new Request("https://wip.example/drinks/?view=all", {
      headers: { Accept: "text/html" },
    }),
    async () => null,
    async () => new Response("private"),
  );
  assert.equal(response.status, 302);
  assert.equal(
    response.headers.get("Location"),
    "/login/?next=%2Fdrinks%2F%3Fview%3Dall",
  );
  assert.equal(loginDestination("/drinks/?view=all"), "/drinks/?view=all");
  for (const value of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/login/",
    "/api/auth/get-session",
    "/\n/evil.example",
  ])
    assert.equal(loginDestination(value), "/admin/");
});
test("authenticated WIP responses cannot be cached; unavailable auth fails closed", async () => {
  const request = new Request("https://wip.example/photographs/");
  const response = await previewResponse(
    request,
    async () => "editor@example.com",
    async () =>
      new Response("private", {
        headers: {
          "Cache-Control": "public, max-age=31536000",
          "Content-Type": "text/html",
        },
      }),
  );
  assert.equal(await response.text(), "private");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const failure = await previewResponse(
    request,
    async () => {
      throw new Error("database unavailable");
    },
    async () => {
      throw new Error("must not serve assets");
    },
  );
  assert.equal(failure.status, 503);
});

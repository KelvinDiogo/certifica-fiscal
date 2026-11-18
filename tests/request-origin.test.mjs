import test from "node:test";
import assert from "node:assert/strict";
import { sameOrigin } from "../lib/request-origin.mjs";
test("same-origin writes work behind a Next.js bind address or Vercel proxy", () => {
  assert.equal(sameOrigin("http://localhost:3000", "localhost:3000"), true);
  assert.equal(
    sameOrigin(
      "https://certifica-fiscal.vercel.app",
      "certifica-fiscal.vercel.app",
    ),
    true,
  );
});
test("cross-site, malformed, missing and credential-bearing origins fail closed", () => {
  for (const origin of [
    "https://evil.example",
    "null",
    "https://user:pass@certifica-fiscal.vercel.app",
    "javascript:alert(1)",
    null,
  ])
    assert.equal(sameOrigin(origin, "certifica-fiscal.vercel.app"), false);
  assert.equal(sameOrigin("https://certifica-fiscal.vercel.app", null), false);
  assert.equal(
    sameOrigin(
      "https://certifica-fiscal.vercel.app.evil.example",
      "certifica-fiscal.vercel.app",
    ),
    false,
  );
});

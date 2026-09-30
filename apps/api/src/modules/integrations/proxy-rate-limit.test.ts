/**
 * The proxy's status bookkeeping must not stamp `lastError` (Settings →
 * "Needs attention") for a transient rate limit. Header-only check.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { isRateLimitedUpstream } from "./proxy.js";

test("429 is always a rate limit", () => {
  assert.equal(isRateLimitedUpstream(429, new Headers()), true);
});

test("403 with remaining 0 (GitHub or GitLab spelling) is a rate limit", () => {
  assert.equal(isRateLimitedUpstream(403, new Headers({ "x-ratelimit-remaining": "0" })), true);
  assert.equal(isRateLimitedUpstream(403, new Headers({ "ratelimit-remaining": "0" })), true);
});

test("403 with Retry-After (GitHub secondary limit) is a rate limit", () => {
  assert.equal(
    isRateLimitedUpstream(403, new Headers({ "retry-after": "60", "x-ratelimit-remaining": "4000" })),
    true,
  );
});

test("a plain 403 / 401 / 500 is a real error", () => {
  assert.equal(isRateLimitedUpstream(403, new Headers({ "x-ratelimit-remaining": "4999" })), false);
  assert.equal(isRateLimitedUpstream(401, new Headers()), false);
  assert.equal(isRateLimitedUpstream(500, new Headers({ "retry-after": "5" })), false);
});

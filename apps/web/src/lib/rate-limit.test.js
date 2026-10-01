import test from "node:test";
import assert from "node:assert/strict";
import {
  clearRateLimits,
  detectRateLimit,
  fetchWithRateLimitRetry,
  getRateLimit,
  getRateLimitSnapshot,
  markRateLimited,
  rateLimitedUntil,
  subscribeRateLimits,
} from "./rate-limit.js";

function res(status, body = {}, headers = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function countingFetch(responses) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return typeof next === "function" ? next() : next.clone();
  };
  return { calls, impl };
}

test("primary: 403 with remaining 0 waits until x-ratelimit-reset", () => {
  const now = 1_700_000_000_000;
  const out = detectRateLimit(
    403,
    new Headers({
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String(now / 1000 + 600),
      "x-ratelimit-resource": "search",
    }),
    "{}",
    now,
  );
  assert.deepEqual(out, { kind: "primary", waitMs: 600_000, resource: "search" });
});

test("GitLab's un-prefixed RateLimit-Remaining 0 is a primary limit", () => {
  const now = 1_700_000_000_000;
  const out = detectRateLimit(
    429,
    new Headers({ "ratelimit-remaining": "0", "ratelimit-reset": String(now / 1000 + 30) }),
    "",
    now,
  );
  assert.equal(out.kind, "primary");
  assert.equal(out.waitMs, 30_000);
});

test("secondary: 403 with a positive remaining + body text is recognised", () => {
  const out = detectRateLimit(
    403,
    new Headers({ "x-ratelimit-remaining": "4000" }),
    JSON.stringify({ message: "You have exceeded a secondary rate limit." }),
  );
  assert.equal(out.kind, "secondary");
  assert.equal(out.waitMs, 60_000, "nothing advertised → one minute");
});

test("secondary: 403 with Retry-After is recognised and honoured", () => {
  const out = detectRateLimit(403, new Headers({ "retry-after": "90" }), "");
  assert.deepEqual(out, { kind: "secondary", waitMs: 90_000, resource: null });
});

test("a plain 403 (bad credentials) is not a rate limit", () => {
  assert.equal(
    detectRateLimit(403, new Headers({ "x-ratelimit-remaining": "4999" }), '{"message":"Bad credentials"}'),
    null,
  );
  assert.equal(detectRateLimit(500, new Headers(), ""), null);
});

test("a long limit opens the breaker: recorded until, then fail fast without sending", async () => {
  clearRateLimits();
  const { calls, impl } = countingFetch([
    res(403, { message: "API rate limit exceeded" }, {
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 1200),
    }),
  ]);
  const events = [];
  const off = subscribeRateLimits((_s, detail) => events.push(detail));
  const first = await fetchWithRateLimitRetry("/x", {}, { provider: "gitlab", fetchImpl: impl });
  assert.equal(first.status, 403);
  assert.equal(calls.length, 1, "no in-place retry for a 20-minute wait");
  const until = rateLimitedUntil("gitlab");
  assert.ok(until > Date.now() + 1_100_000 && until <= Date.now() + 1_200_000);
  assert.equal(events.length, 1);
  assert.equal(events[0].provider, "gitlab");

  const second = await fetchWithRateLimitRetry("/y", {}, { provider: "gitlab", fetchImpl: impl });
  assert.equal(calls.length, 1, "limited provider: nothing sent");
  assert.equal(second.status, 429);
  assert.equal(second.headers.get("x-devhub-local-rate-limit"), "1");
  const body = await second.json();
  assert.equal(body.error.code, "rate_limited");
  assert.ok(body.error.retryAfterMs > 0);

  // Other providers are unaffected.
  const { calls: jiraCalls, impl: jiraImpl } = countingFetch([res(200, { ok: true })]);
  const ok = await fetchWithRateLimitRetry("/z", {}, { provider: "jira", fetchImpl: jiraImpl });
  assert.equal(ok.status, 200);
  assert.equal(jiraCalls.length, 1);
  off();
  clearRateLimits();
});

test("a short wait (< 10s) is retried exactly once in place", async () => {
  clearRateLimits();
  const { calls, impl } = countingFetch([
    res(429, {}, { "retry-after": "0" }),
    res(200, { ok: true }),
  ]);
  const out = await fetchWithRateLimitRetry("/x", {}, { provider: "jira", fetchImpl: impl });
  assert.equal(out.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(getRateLimit("jira"), null, "a blip that cleared never opens the breaker");
});

test("still limited after the one short retry → breaker opens, no third attempt", async () => {
  clearRateLimits();
  const { calls, impl } = countingFetch([res(429, {}, { "retry-after": "0" })]);
  const out = await fetchWithRateLimitRetry("/x", {}, { provider: "jenkins", fetchImpl: impl });
  assert.equal(out.status, 429);
  assert.equal(calls.length, 2);
  assert.ok(getRateLimit("jenkins"), "recorded");
  clearRateLimits();
});

test("GitHub search exhaustion blocks search only; secondary blocks everything", async () => {
  clearRateLimits();
  const reset = String(Math.floor(Date.now() / 1000) + 60);
  const { impl } = countingFetch([
    res(403, {}, {
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": reset,
      "x-ratelimit-resource": "search",
    }),
  ]);
  await fetchWithRateLimitRetry("/s", {}, { provider: "github", bucket: "search", fetchImpl: impl });
  assert.ok(getRateLimit("github", "search"));
  assert.equal(getRateLimit("github", "core"), null);

  markRateLimited("github", { until: Date.now() + 30_000, kind: "secondary" });
  assert.ok(getRateLimit("github", "core"));
  assert.ok(getRateLimitSnapshot().byProvider.github);
  clearRateLimits();
  assert.deepEqual(getRateLimitSnapshot().byProvider, {});
});

test("a limit extends but never shortens", () => {
  clearRateLimits();
  const t = Date.now();
  markRateLimited("ai", { until: t + 60_000 });
  markRateLimited("ai", { until: t + 10_000 });
  assert.equal(rateLimitedUntil("ai"), t + 60_000);
  clearRateLimits();
});

test("api-client reads our API's 429 wait: Retry-After, envelope, draft-7", async () => {
  const { retryAfterMsFrom } = await import("./api-client.js");
  assert.equal(retryAfterMsFrom(new Headers({ "retry-after": "3" }), null), 3_000);
  assert.equal(retryAfterMsFrom(new Headers(), { error: { retryAfterMs: 1_500 } }), 1_500);
  assert.equal(
    retryAfterMsFrom(new Headers({ ratelimit: "limit=30, remaining=0, reset=840" }), null),
    840_000,
  );
  assert.equal(retryAfterMsFrom(new Headers(), {}), null);
});

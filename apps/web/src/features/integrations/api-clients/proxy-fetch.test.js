import test from "node:test";
import assert from "node:assert/strict";
import {
  githubBucketForPath,
  isNotModified,
  NOT_MODIFIED,
  proxyFetch,
} from "./proxy-fetch.js";
import { clearRateLimits, getRateLimit } from "../../../lib/rate-limit.js";

test("proxyFetch aborts at its overall deadline", async () => {
  const hang = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")),
      );
    });
  const started = Date.now();
  await assert.rejects(
    proxyFetch("jira", "search/jql", { fetchImpl: hang, deadlineMs: 50 }),
    (err) => err.code === "timeout" && err.timedOut === true && err.provider === "jira",
  );
  assert.ok(Date.now() - started < 2_000);
});

test("a caller abort is still an AbortError, not a timeout", async () => {
  const controller = new AbortController();
  const hang = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")),
      );
    });
  const p = proxyFetch("jira", "x", { fetchImpl: hang, signal: controller.signal });
  controller.abort();
  await assert.rejects(p, (err) => err.name === "AbortError");
});

test("304 returns the NOT_MODIFIED sentinel instead of throwing", async () => {
  const out = await proxyFetch("github", "users/me/events/public", {
    fetchImpl: async () => new Response(null, { status: 304 }),
  });
  assert.equal(out, NOT_MODIFIED);
  assert.equal(isNotModified(out), true);
});

test("a rate-limited response throws a tagged error and later calls fail fast", async () => {
  clearRateLimits();
  let sent = 0;
  const fetchImpl = async () => {
    sent += 1;
    return new Response(JSON.stringify({ message: "secondary rate limit" }), {
      status: 403,
      headers: { "content-type": "application/json", "retry-after": "120" },
    });
  };
  await assert.rejects(proxyFetch("github", "search/issues?q=x", { fetchImpl }), (err) => {
    assert.equal(err.rateLimited, true);
    assert.equal(err.code, "rate_limited");
    assert.ok(err.rateLimitedUntil > Date.now() + 100_000);
    return true;
  });
  assert.ok(getRateLimit("github", "core"), "secondary limit is provider-wide");
  await assert.rejects(proxyFetch("github", "user", { fetchImpl }), (err) => err.localOnly === true);
  assert.equal(sent, 1);
  clearRateLimits();
});

test("GitHub paths map to their rate-limit bucket", () => {
  assert.equal(githubBucketForPath("github", "search/issues?q=1"), "search");
  assert.equal(githubBucketForPath("github", "/repos/a/b/pulls/1"), "core");
  assert.equal(githubBucketForPath("gitlab", "search/x"), null);
});

import test from "node:test";
import assert from "node:assert/strict";

import { gradePrPauseMs, gradeProgressLabel, MAX_PAUSE_MS } from "./grade-pause.js";

const headers = (h) => ({ get: (k) => h[k.toLowerCase()] ?? null });

test("the pause matches the server's advertised window, not a 2-minute cap", () => {
  // express-rate-limit (gradePrLimiter, 15-min window) → Retry-After: 840
  assert.equal(gradePrPauseMs(headers({ "retry-after": "840" }), null), 840_000);
  // draft-7 RateLimit header alone
  assert.equal(gradePrPauseMs(headers({ ratelimit: "limit=300, remaining=0, reset=600" }), null), 600_000);
  // model-provider envelope
  assert.equal(gradePrPauseMs(headers({}), { error: { retryAfterMs: 30_000 } }), 30_000);
});

test("pauses are clamped", () => {
  assert.equal(gradePrPauseMs(headers({ "retry-after": "99999" }), null), MAX_PAUSE_MS);
  assert.equal(gradePrPauseMs(headers({ "retry-after": "0" }), null), 1_000);
  assert.equal(gradePrPauseMs(headers({}), null, 2), 60_000);
});

test("one progress line, including the paused state", () => {
  assert.equal(gradeProgressLabel({ running: false }), null);
  assert.equal(gradeProgressLabel({ running: true, done: 3, total: 10 }), "Grading 3/10…");
  const now = Date.now();
  const label = gradeProgressLabel({ running: true, done: 3, total: 10, pausedUntil: now + 60_000 }, now);
  assert.match(label, /^Paused by the rate limit · resumes .+ · 3\/10$/);
});

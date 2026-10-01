import test from "node:test";
import assert from "node:assert/strict";
import { asOfLabel, relativeAgo, resolveLiveState } from "./live-value-state.js";

const NOW = new Date(2026, 9, 1, 11, 0, 0).getTime();
const TEN_42 = new Date(2026, 9, 1, 10, 42, 0).getTime();
const ELEVEN_05 = new Date(2026, 9, 1, 11, 5, 0).getTime();

test("first load with nothing cached is a skeleton, not a dash or a zero", () => {
  const s = resolveLiveState({ hasValue: false, pending: true, provider: "GitHub" }, NOW);
  assert.equal(s.kind, "skeleton");
  assert.equal(s.message, null);
});

test("a refresh with a value on screen keeps the value and says updating", () => {
  const s = resolveLiveState({ hasValue: true, refreshing: true, fetchedAt: TEN_42 }, NOW);
  assert.equal(s.kind, "value");
  assert.equal(s.tone, "updating");
  assert.equal(s.note, "updating…");
});

test("an up-to-date value carries a relative stamp with an absolute tooltip", () => {
  const s = resolveLiveState({ hasValue: true, fetchedAt: NOW - 5 * 60_000 }, NOW);
  assert.equal(s.kind, "value");
  assert.equal(s.tone, "quiet");
  assert.equal(s.note, "updated 5 min ago");
  assert.match(s.title, /^Fetched /);
});

test("rate limited with a last value: value + as-of + when it resumes", () => {
  const s = resolveLiveState(
    { hasValue: true, fetchedAt: TEN_42, rateLimitedUntil: ELEVEN_05, provider: "GitHub" },
    NOW,
  );
  assert.equal(s.kind, "value");
  assert.equal(s.tone, "warn");
  assert.match(s.note, /^as of .*10.?42.* · GitHub rate limit — refreshing at .*11.?05/);
  assert.equal(s.canRetry, false);
});

test("rate limited with nothing cached shows the reason in place of the number", () => {
  const s = resolveLiveState(
    { hasValue: false, pending: true, error: { rateLimited: true }, rateLimitedUntil: ELEVEN_05, provider: "GitHub" },
    NOW,
  );
  assert.equal(s.kind, "limited");
  assert.match(s.message, /GitHub rate limit — refreshing at/);
});

test("an error flag alone (no until) still reads as a limit, not a fault", () => {
  const s = resolveLiveState({ hasValue: true, error: { rateLimited: true }, provider: "Jira" }, NOW);
  assert.equal(s.tone, "warn");
  assert.match(s.note, /Jira rate limit — retrying shortly/);
});

test("an expired limit no longer counts", () => {
  const s = resolveLiveState({ hasValue: true, fetchedAt: TEN_42, rateLimitedUntil: NOW - 1 }, NOW);
  assert.equal(s.tone, "quiet");
});

test("a failed refresh keeps the last value with as-of, the reason and a retry", () => {
  const s = resolveLiveState(
    { hasValue: true, fetchedAt: TEN_42, error: new Error("502"), provider: "GitLab" },
    NOW,
  );
  assert.equal(s.kind, "value");
  assert.equal(s.tone, "error");
  assert.match(s.note, /as of .* · Couldn't reach GitLab/);
  assert.equal(s.canRetry, true);
});

test("a failure with nothing cached is an error, distinct from empty", () => {
  const s = resolveLiveState({ hasValue: false, error: new Error("x"), provider: "GitLab" }, NOW);
  assert.equal(s.kind, "error");
  assert.equal(s.message, "Couldn't reach GitLab");
  assert.equal(s.canRetry, true);
});

test("resolved with genuinely nothing reads 'No activity yet'", () => {
  const s = resolveLiveState({ hasValue: false, pending: false }, NOW);
  assert.equal(s.kind, "empty");
  assert.equal(s.message, "No activity yet");
  assert.equal(resolveLiveState({ emptyLabel: "No merges yet" }, NOW).message, "No merges yet");
});

test("the five situations never collapse into the same look", () => {
  const kinds = [
    resolveLiveState({ pending: true }, NOW),
    resolveLiveState({ hasValue: true, refreshing: true }, NOW),
    resolveLiveState({ hasValue: false, rateLimitedUntil: ELEVEN_05 }, NOW),
    resolveLiveState({ hasValue: false, error: new Error("x") }, NOW),
    resolveLiveState({}, NOW),
  ].map((s) => `${s.kind}:${s.tone}`);
  assert.equal(new Set(kinds).size, kinds.length);
});

test("relativeAgo and asOfLabel", () => {
  assert.equal(relativeAgo(NOW - 10_000, NOW), "just now");
  assert.equal(relativeAgo(NOW - 2 * 3_600_000, NOW), "2 h ago");
  assert.equal(relativeAgo(NOW - 26 * 3_600_000, NOW), "yesterday");
  assert.equal(relativeAgo(NOW - 3 * 86_400_000, NOW), "3 days ago");
  assert.doesNotMatch(asOfLabel(TEN_42, NOW), /,/);
  assert.match(asOfLabel(NOW - 2 * 86_400_000, NOW), /as of .*,/);
});

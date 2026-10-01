import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalEventsSinceIso,
  canonicalMergedSinceIso,
  filterAuthoredSince,
  filterEventsSince,
  filterMergedSince,
  localMidnight,
  resolveFetchWindow,
  snapSinceIso,
} from "./provider-windows.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 9, 1, 15, 42, 17, 123); // Oct 1 2026, 15:42 local

test("snapSinceIso snaps every input shape to LOCAL midnight", () => {
  const exact = new Date(2026, 7, 2, 13, 5, 9, 876);
  const want = new Date(2026, 7, 2, 0, 0, 0, 0).toISOString();
  assert.equal(snapSinceIso(exact, NOW), want);
  assert.equal(snapSinceIso(exact.toISOString(), NOW), want);
  // days-ago numbers resolve against `now`, then snap.
  assert.equal(snapSinceIso(30, NOW), localMidnight(NOW.getTime() - 30 * DAY).toISOString());
  assert.equal(snapSinceIso(null, NOW), null);
  assert.equal(snapSinceIso("", NOW), null);
  assert.equal(snapSinceIso("not a date", NOW), null);
});

test("snapped keys are stable across a day (the Reviews unstable-key bug)", () => {
  const morning = new Date(2026, 9, 1, 8, 0, 0, 1);
  const evening = new Date(2026, 9, 1, 23, 59, 59, 999);
  const a = snapSinceIso(new Date(morning.getTime() - 60 * DAY), morning);
  const b = snapSinceIso(new Date(evening.getTime() - 60 * DAY), evening);
  assert.equal(a, b);
});

test("the long canonical window covers 365 days AND year-to-date", () => {
  const since = Date.parse(canonicalMergedSinceIso(NOW));
  assert.ok(since <= NOW.getTime() - 365 * DAY, "reaches 365 days back");
  assert.ok(since <= new Date(NOW.getFullYear(), 0, 1).getTime(), "reaches local Jan 1");
  assert.ok(since <= Date.UTC(NOW.getUTCFullYear(), 0, 1), "reaches UTC Jan 1");
  // Snapped: the key doesn't move within the day.
  const later = new Date(NOW.getTime() + 3 * 60 * 60 * 1000);
  assert.equal(canonicalMergedSinceIso(later), canonicalMergedSinceIso(NOW));
  // Dec 31 of a leap year still covers Jan 1.
  const dec31 = new Date(2028, 11, 31, 22, 0, 0);
  assert.ok(Date.parse(canonicalMergedSinceIso(dec31)) <= new Date(2028, 0, 1).getTime());
});

test("the events canonical window reaches 90 days back", () => {
  const since = Date.parse(canonicalEventsSinceIso(NOW));
  assert.ok(since <= NOW.getTime() - 90 * DAY);
  assert.ok(since > NOW.getTime() - 92 * DAY);
});

test("resolveFetchWindow picks the shortest covering canonical window, else the caller's own", () => {
  const events = canonicalEventsSinceIso(NOW);
  const long = canonicalMergedSinceIso(NOW);
  // 30d / 90d → the events window.
  assert.equal(resolveFetchWindow(30, [events, long], NOW).fetchIso, events);
  assert.equal(resolveFetchWindow(90, [events, long], NOW).fetchIso, events);
  // YTD / 120d / 365d → the long window.
  assert.equal(resolveFetchWindow(new Date(NOW.getFullYear(), 0, 1), [events, long], NOW).fetchIso, long);
  assert.equal(resolveFetchWindow(120, [events, long], NOW).fetchIso, long);
  assert.equal(resolveFetchWindow(365, [long], NOW).fetchIso, long);
  // Older than every canonical window → its own key, snapped.
  const old = new Date(2024, 0, 1, 12, 30);
  const w = resolveFetchWindow(old, [long], NOW);
  assert.equal(w.fetchIso, new Date(2024, 0, 1).toISOString());
  // The filter keeps the caller's exact cutoff.
  assert.equal(w.filterIso, old.toISOString());
  assert.equal(resolveFetchWindow(null, [long], NOW), null);
});

test("filterMergedSince reproduces each provider's per-window query semantics", () => {
  const since = "2026-09-01T10:00:00.000Z";
  const rows = [
    // GitHub: `merged:>=2026-09-01` is day-granular — same UTC day is kept.
    { id: "gh-early-same-day", source: "github", merged_at: "2026-09-01T02:00:00Z" },
    { id: "gh-before", source: "github", merged_at: "2026-08-31T23:59:59Z" },
    { id: "gh-after", source: "github", merged_at: "2026-09-10T00:00:00Z" },
    // GitLab: `updated_after=<iso>` is exact, on updated_at.
    { id: "gl-updated-after", source: "gitlab", merged_at: "2026-07-01T00:00:00Z", updated_at: "2026-09-02T00:00:00Z" },
    { id: "gl-updated-before", source: "gitlab", merged_at: "2026-09-01T09:00:00Z", updated_at: "2026-09-01T09:59:59Z" },
    { id: "gl-no-updated", source: "gitlab", merged_at: "2026-09-05T00:00:00Z" },
  ];
  const kept = filterMergedSince(rows, since).map((r) => r.id);
  assert.deepEqual(kept, ["gh-early-same-day", "gh-after", "gl-updated-after", "gl-no-updated"]);
  assert.equal(filterMergedSince(undefined, since), undefined);
});

test("filterMergedSince over the canonical list equals a direct narrower fetch", () => {
  // A 30-day view derived from a year of rows must be exactly the rows a
  // 30-day search would have returned — no rows lost, none extra.
  const now = Date.UTC(2026, 9, 1);
  const year = Array.from({ length: 400 }, (_, i) => ({
    id: `gh-${i}`,
    source: "github",
    merged_at: new Date(now - i * DAY - 3_600_000).toISOString(),
  }));
  const since = new Date(now - 30 * DAY).toISOString();
  const direct = year.filter((r) => Date.parse(r.merged_at) >= Date.parse(since.slice(0, 10)));
  assert.deepEqual(filterMergedSince(year, since), direct);
  assert.equal(filterMergedSince(year, since).length, 30);
});

test("filterEventsSince / filterAuthoredSince trim to the cutoff", () => {
  const since = "2026-09-01T10:00:00.000Z";
  const events = [
    { created_at: "2026-09-01T09:59:59Z" },
    { created_at: "2026-09-01T10:00:00Z" },
    { created_at: "not-a-date" },
  ];
  assert.equal(filterEventsSince(events, since).length, 1);
  const authored = [{ created_at: "2026-09-01T01:00:00Z" }, { created_at: "2026-08-31T23:00:00Z" }];
  assert.equal(filterAuthoredSince(authored, since).length, 1);
});

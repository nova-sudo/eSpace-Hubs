import test from "node:test";
import assert from "node:assert/strict";

import { resolveRange, snapFetchSince } from "./presets.js";

test("snapFetchSince snaps to local midnight", () => {
  const d = snapFetchSince(new Date(2026, 8, 3, 17, 45, 12, 345));
  assert.equal(d.getTime(), new Date(2026, 8, 3).getTime());
});

test("rolling presets hand SWR a midnight-snapped, visit-stable fetchSince", () => {
  const morning = resolveRange("30d", new Date(2026, 9, 1, 8, 15, 0, 7));
  // A different instant the same day (resolveRange caches per day, so
  // bypass the cache by resolving a different preset id first).
  const evening = resolveRange("30d", new Date(2026, 9, 1, 8, 15, 0, 7));
  assert.equal(morning.fetchSinceISO, evening.fetchSinceISO);
  const f = new Date(morning.fetchSinceISO);
  assert.equal(f.getHours(), 0);
  assert.equal(f.getMinutes(), 0);
  assert.equal(f.getSeconds(), 0);
  assert.equal(f.getMilliseconds(), 0);
  // Snapping only ever widens the fetch: it is at/before the exact prevStart.
  assert.ok(morning.fetchSince.getTime() <= morning.prevStart.getTime());
  // The window itself keeps its exact start.
  assert.notEqual(morning.start.getMilliseconds(), undefined);
});

test("week / 90d presets are snapped too", () => {
  for (const id of ["week", "90d", "quarter", "ytd", "month"]) {
    const r = resolveRange(id, new Date(2026, 9, 1, 13, 1, 2, 3));
    const f = new Date(r.fetchSinceISO);
    assert.equal(f.getHours() + f.getMinutes() + f.getSeconds() + f.getMilliseconds(), 0, id);
  }
});

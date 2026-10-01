import test from "node:test";
import assert from "node:assert/strict";

import { isRegradeThrottled, localDayKey } from "./tier-throttle.js";

const NOW = new Date("2026-10-01T12:00:00Z");
const hit = (gradedAt: string, provider: string | null = "mistral") => ({
  tierHash: "old",
  gradedAt: new Date(gradedAt),
  provider,
});

test("a changed hash graded by the model earlier today is throttled", () => {
  assert.equal(
    isRegradeThrottled({ hit: hit("2026-10-01T08:00:00Z"), tierHash: "new", now: NOW }),
    true,
  );
});

test("yesterday's grade lets today's data change through", () => {
  assert.equal(
    isRegradeThrottled({ hit: hit("2026-09-30T08:00:00Z"), tierHash: "new", now: NOW }),
    false,
  );
});

test("force and a real criteria change are never throttled", () => {
  const h = hit("2026-10-01T08:00:00Z");
  assert.equal(isRegradeThrottled({ hit: h, tierHash: "new", force: true, now: NOW }), false);
  assert.equal(isRegradeThrottled({ hit: h, tierHash: "new", criteriaChanged: true, now: NOW }), false);
});

test("first grades, same-hash hits and client-mirrored rows are not throttled", () => {
  assert.equal(isRegradeThrottled({ hit: null, tierHash: "new", now: NOW }), false);
  assert.equal(
    isRegradeThrottled({ hit: { ...hit("2026-10-01T08:00:00Z"), tierHash: "new" }, tierHash: "new", now: NOW }),
    false,
  );
  assert.equal(
    isRegradeThrottled({ hit: hit("2026-10-01T08:00:00Z", "client-numeric"), tierHash: "new", now: NOW }),
    false,
  );
});

test("'today' is the user's day, from their timezone offset", () => {
  // 22:30Z on Sep 30 is already Oct 1 in Cairo (UTC+3 → offset -180).
  const h = hit("2026-09-30T22:30:00Z");
  assert.equal(isRegradeThrottled({ hit: h, tierHash: "new", now: NOW, tzOffsetMinutes: -180 }), true);
  assert.equal(isRegradeThrottled({ hit: h, tierHash: "new", now: NOW, tzOffsetMinutes: 0 }), false);
  assert.equal(localDayKey(new Date("2026-09-30T22:30:00Z"), -180), "2026-10-01");
});

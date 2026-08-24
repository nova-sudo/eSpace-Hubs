import test from "node:test";
import assert from "node:assert/strict";

import { firstPassRatePct } from "./first-pass-rate.js";
import { mergedWithin } from "./merged.js";

function withFixedNow(nowIso, fn) {
  const originalNow = Date.now;
  Date.now = () => Date.parse(nowIso);
  try {
    return fn();
  } finally {
    Date.now = originalNow;
  }
}

function mr(notes, mergedAt = "2026-06-01T12:00:00Z") {
  return { merged_at: mergedAt, user_notes_count: notes };
}

test("firstPassRatePct classifies ≤1 note as clean, ≥2 as ping-pong", () => {
  const result = firstPassRatePct([mr(0), mr(1), mr(2), mr(7)]);
  assert.deepEqual(result, { pct: 50, clean: 2, pingPong: 2 });
});

test("firstPassRatePct treats a missing notes field as clean", () => {
  const result = firstPassRatePct([
    { merged_at: "2026-06-01T12:00:00Z" },
    { merged_at: "2026-06-01T12:00:00Z", user_notes_count: undefined },
    mr(3),
  ]);
  assert.deepEqual(result, { pct: 67, clean: 2, pingPong: 1 });
});

test("firstPassRatePct ignores unmerged rows and returns null when empty", () => {
  assert.equal(firstPassRatePct([]), null);
  assert.equal(firstPassRatePct([{ merged_at: null, user_notes_count: 5 }]), null);
  const result = firstPassRatePct([{ merged_at: null }, mr(0)]);
  assert.deepEqual(result, { pct: 100, clean: 1, pingPong: 0 });
});

// The frozen "130 clean / 9 ping-pong" regression: GitLab pages merged MRs
// by `updated_after`, so prior-year merges that were touched this year leak
// into the fetch. The data-source layer must slice to `merged_at` within
// the YTD window before handing the array to firstPassRatePct — without
// that, clean+pingPong equals the raw fetch size forever.
test("windowing merged rows by merged_at excludes prior-year leakage", () => {
  withFixedNow("2026-08-24T12:00:00Z", () => {
    const ytdDays = Math.ceil(
      (Date.now() - Date.parse("2026-01-01T00:00:00Z")) / 86_400_000,
    );
    const thisYear = Array.from({ length: 130 }, (_, i) =>
      mr(i % 10 === 0 ? 4 : 0, "2026-03-01T12:00:00Z"),
    );
    const priorYear = Array.from({ length: 9 }, () =>
      mr(2, "2025-11-15T12:00:00Z"),
    );
    const fetched = [...thisYear, ...priorYear];

    const unwindowed = firstPassRatePct(fetched);
    assert.equal(unwindowed.clean + unwindowed.pingPong, 139);

    const windowed = firstPassRatePct(mergedWithin(fetched, ytdDays));
    assert.equal(windowed.clean + windowed.pingPong, 130);
    assert.deepEqual(windowed, { pct: 90, clean: 117, pingPong: 13 });
  });
});

// Hydration math: a GitHub row whose search-derived count was 0 flips to
// ping-pong once real review-comment counts (comments + review_comments)
// are folded into user_notes_count.
test("hydrated GitHub review counts flip silently-reviewed rows to ping-pong", () => {
  const rows = [mr(0), mr(0), mr(1)];
  assert.deepEqual(firstPassRatePct(rows), { pct: 100, clean: 3, pingPong: 0 });
  const hydrated = rows.map((m, i) =>
    i === 0 ? { ...m, user_notes_count: 0 + 5 } : m,
  );
  assert.deepEqual(firstPassRatePct(hydrated), {
    pct: 67,
    clean: 2,
    pingPong: 1,
  });
});

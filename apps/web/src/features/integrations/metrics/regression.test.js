import test from "node:test";
import assert from "node:assert/strict";

import { linkagePct } from "./linkage.js";
import { mergedThisWeek, mergedWithin } from "./merged.js";
import {
  fmtDurationHours,
  meanTurnaroundDays,
  medianTurnaroundDays,
  turnaroundHistogram,
} from "./turnaround.js";
import {
  aggregateTiming,
  computePrReviewTiming,
  fmtMs,
} from "./review-timing.js";

const EN_DASH = String.fromCharCode(8211);
const EM_DASH = String.fromCharCode(8212);

function withFixedNow(nowIso, fn) {
  const originalNow = Date.now;
  Date.now = () => Date.parse(nowIso);
  try {
    return fn();
  } finally {
    Date.now = originalNow;
  }
}

function mergedAt(iso) {
  return { merged_at: iso };
}

function durationMr(hours) {
  const created = Date.parse("2026-06-01T00:00:00Z");
  return {
    created_at: new Date(created).toISOString(),
    merged_at: new Date(created + hours * 3_600_000).toISOString(),
  };
}

test("merged metrics separate current and previous 7-day windows", () => {
  withFixedNow("2026-06-13T12:00:00Z", () => {
    const mrs = [
      mergedAt("2026-06-13T10:00:00Z"),
      mergedAt("2026-06-10T12:00:00Z"),
      mergedAt("2026-06-06T12:00:00Z"),
      mergedAt("2026-06-06T11:59:59Z"),
      mergedAt("2026-06-01T09:00:00Z"),
      mergedAt("2026-05-29T11:59:59Z"),
      { merged_at: null },
    ];

    assert.equal(mergedWithin(mrs, 7).length, 3);
    assert.deepEqual(mergedThisWeek(mrs), { count: 3, delta: 1 });
  });
});

test("linkage percentage reads Jira keys from title, description, and branch", () => {
  const result = linkagePct([
    {
      merged_at: "2026-06-01T00:00:00Z",
      title: "BIDAYA-123 add onboarding copy",
    },
    {
      merged_at: "2026-06-02T00:00:00Z",
      description: "Fixes PAY-4812",
    },
    {
      merged_at: "2026-06-03T00:00:00Z",
      source_branch: "feature/OPS-77-review-timing",
    },
    {
      merged_at: "2026-06-04T00:00:00Z",
      title: "cleanup dashboard spacing",
    },
    {
      title: "BIDAYA-999 open but not merged",
    },
  ]);

  assert.deepEqual(result, { pct: 75, linked: 3, loose: 1 });
  assert.equal(linkagePct([]), null);
});

test("turnaround metrics keep median, mean, histogram, and labels stable", () => {
  const mrs = [
    durationMr(1),
    durationMr(4),
    durationMr(12),
    durationMr(36),
    durationMr(72),
    durationMr(120),
  ];

  assert.equal(
    medianTurnaroundDays([durationMr(24), durationMr(72), durationMr(120)]),
    3,
  );
  assert.equal(
    meanTurnaroundDays([durationMr(24), durationMr(72), durationMr(120)]),
    3,
  );
  assert.deepEqual(
    turnaroundHistogram(mrs).map(({ label, n }) => ({ label, n })),
    [
      { label: "<2h", n: 1 },
      { label: `2${EN_DASH}8h`, n: 1 },
      { label: `8${EN_DASH}24h`, n: 1 },
      { label: `1${EN_DASH}2d`, n: 1 },
      { label: `2${EN_DASH}4d`, n: 1 },
      { label: ">4d", n: 1 },
    ],
  );
  assert.equal(fmtDurationHours(null), EM_DASH);
  assert.equal(fmtDurationHours(0.5), "12h");
  assert.equal(fmtDurationHours(2.25), "2.3d");
});

test("review timing excludes author replies and aggregates reviewer wait time", () => {
  const timing = computePrReviewTiming(
    { createdAt: "2026-06-01T10:00:00Z", author: "dev" },
    [
      { createdAt: "2026-06-01T10:30:00Z", user: "dev" },
      { createdAt: "2026-06-01T11:00:00Z", user: "reviewer-a" },
      { createdAt: "2026-06-01T12:00:00Z", user: "reviewer-a" },
      { createdAt: "2026-06-01T15:00:00Z", user: "reviewer-b" },
    ],
  );

  assert.equal(timing.ttfr, 3_600_000);
  assert.deepEqual(timing.nthGaps, [3_600_000, 10_800_000]);
  assert.equal(timing.attnr, 7_200_000);
  assert.equal(timing.idle, 18_000_000);
  assert.deepEqual(timing.reviewers, ["reviewer-a", "reviewer-b"]);

  assert.deepEqual(aggregateTiming([timing]), {
    medianTtfr: 3_600_000,
    medianAttnr: 7_200_000,
    totalIdle: 18_000_000,
    prCount: 1,
    prsWithReview: 1,
  });
  assert.equal(fmtMs(90_000), "2m");
  assert.equal(fmtMs(90 * 60_000), "1.5h");
  assert.equal(fmtMs(36 * 3_600_000), "1.5d");
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  writeUpLatencyHours,
  restorationMinutes,
  summarizeTimeliness,
} from "./defects.js";

/**
 * Two goals that read like document goals are subtractions between two
 * instants. The rule that matters throughout: an incident missing a timestamp
 * is UNMEASURED, never breached. Absent is not the same as failed, and a
 * grader told otherwise marks people down for a gap in data entry.
 */

const at = (iso) => new Date(iso).toISOString();
const incident = (value) => ({ ts: Date.now(), value });

test("write-up latency is the gap between resolution and publication", () => {
  const hours = writeUpLatencyHours({
    resolvedAt: at("2026-03-01T09:00:00Z"),
    writeUpAt: at("2026-03-02T21:00:00Z"),
  });
  assert.equal(hours, 36);
});

test("latency is null when either instant is missing", () => {
  assert.equal(writeUpLatencyHours({ resolvedAt: at("2026-03-01T09:00:00Z") }), null);
  assert.equal(writeUpLatencyHours({ writeUpAt: at("2026-03-01T09:00:00Z") }), null);
  assert.equal(writeUpLatencyHours({}), null);
  assert.equal(writeUpLatencyHours(null), null);
});

test("a write-up stamped before the resolution clamps to zero, not a negative", () => {
  const hours = writeUpLatencyHours({
    resolvedAt: at("2026-03-02T09:00:00Z"),
    writeUpAt: at("2026-03-01T09:00:00Z"),
  });
  assert.equal(hours, 0);
});

test("restoration minutes read the recorded duration", () => {
  assert.equal(restorationMinutes({ downtime: 45 }), 45);
  assert.equal(restorationMinutes({ downtime: 0 }), 0);
  assert.equal(restorationMinutes({}), null);
  assert.equal(restorationMinutes({ downtime: -5 }), null);
});

test("write-up compliance separates breached from unmeasured", () => {
  const out = summarizeTimeliness(
    [
      // 12h — inside
      incident({
        severity: "P2",
        resolvedAt: at("2026-03-01T00:00:00Z"),
        writeUpAt: at("2026-03-01T12:00:00Z"),
      }),
      // 72h — breached
      incident({
        severity: "P1",
        resolvedAt: at("2026-03-01T00:00:00Z"),
        writeUpAt: at("2026-03-04T00:00:00Z"),
      }),
      // no timestamps at all
      incident({ severity: "P3" }),
    ],
    { writeUpWithinHours: 48 },
  );

  assert.equal(out.writeUpMeasured, 2);
  assert.equal(out.writeUpWithin, 1);
  assert.equal(out.writeUpBreached, 1);
  assert.equal(out.writeUpUnmeasured, 1, "the undated incident is unknown, not late");
  assert.equal(out.medianWriteUpHours, 42);
  assert.equal(out.slowestWriteUp.hours, 72);
  assert.equal(out.slowestWriteUp.severity, "P1");
});

test("a per-incident restoration ceiling is not the same as a summed budget", () => {
  // Two incidents, 10 and 200 minutes. A quarterly budget of 240 minutes is
  // comfortably met, yet one incident blew a two-hour per-incident ceiling.
  const out = summarizeTimeliness(
    [incident({ severity: "P3", downtime: 10 }), incident({ severity: "P1", downtime: 200 })],
    { restoreWithinMinutes: 120 },
  );

  assert.equal(out.restoreMeasured, 2);
  assert.equal(out.restoreWithin, 1);
  assert.equal(out.restoreBreached, 1);
});

test("no ceiling configured means nothing is judged against one", () => {
  const out = summarizeTimeliness([incident({ severity: "P1", downtime: 999 })]);
  assert.equal(out.hasWriteUpCeiling, false);
  assert.equal(out.hasRestoreCeiling, false);
  assert.equal(out.restoreWithin, 1, "without a ceiling nothing counts as a breach");
});

test("an empty log reports nothing rather than a perfect score", () => {
  const out = summarizeTimeliness([], { writeUpWithinHours: 48 });
  assert.equal(out.count, 0);
  assert.equal(out.writeUpMeasured, 0);
  assert.equal(out.medianWriteUpHours, null);
  assert.equal(out.slowestWriteUp, null);
});

test("the median is the middle of an odd list and the mean of the middle two", () => {
  const mk = (h) =>
    incident({
      severity: "P3",
      resolvedAt: at("2026-03-01T00:00:00Z"),
      writeUpAt: new Date(Date.parse("2026-03-01T00:00:00Z") + h * 3_600_000).toISOString(),
    });

  assert.equal(summarizeTimeliness([mk(1), mk(5), mk(9)]).medianWriteUpHours, 5);
  assert.equal(summarizeTimeliness([mk(1), mk(5), mk(9), mk(11)]).medianWriteUpHours, 7);
});

test("exactly on the ceiling counts as met, not missed", () => {
  const out = summarizeTimeliness(
    [
      incident({
        severity: "P2",
        downtime: 120,
        resolvedAt: at("2026-03-01T00:00:00Z"),
        writeUpAt: at("2026-03-03T00:00:00Z"),
      }),
    ],
    { writeUpWithinHours: 48, restoreWithinMinutes: 120 },
  );

  assert.equal(out.writeUpBreached, 0);
  assert.equal(out.restoreBreached, 0);
});

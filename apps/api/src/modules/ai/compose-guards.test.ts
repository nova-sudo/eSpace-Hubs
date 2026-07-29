import test from "node:test";
import assert from "node:assert/strict";

import {
  dropPeriodEchoFields,
  findUngradeableTiers,
} from "./controller.js";

/**
 * Regression cover for the two composed-tracker guards.
 *
 * Both exist because a real 13-week plan produced a tracker with:
 *   - a "Plan Week" select, duplicating the period stamp every record already
 *     carries (two answers to one question, free to drift apart), and
 *   - `roleModel = "All 13 weekly deliverables completed on time"` against
 *     fields that never recorded which deliverable belonged to which week —
 *     a top tier nothing could grade.
 *
 * The prompt asks for neither, so these are enforced server-side. Both guards
 * are deliberately conservative: dropping a real field or crying wolf on a
 * legitimate tier is worse than missing a case, so the tests below pin the
 * NEGATIVE cases as hard as the positive ones.
 */

const field = (label: string, kind = "select") => ({ id: "f", kind, label });

// ─── dropPeriodEchoFields ────────────────────────────────────────────

test("drops a bare period-echo field when the tracker has a cadence", () => {
  const { fields, dropped } = dropPeriodEchoFields(
    [field("Plan Week"), field("Blockers", "text")],
    "weekly",
  );
  assert.deepEqual(dropped, ["Plan Week"]);
  assert.equal(fields.length, 1);
  assert.equal(fields[0].label, "Blockers");
});

test("drops the other period-echo phrasings", () => {
  for (const label of [
    "Week",
    "Month number",
    "Which quarter",
    "Current sprint",
    "Period #",
    "the month",
  ]) {
    const { dropped } = dropPeriodEchoFields(
      [field(label), field("Notes", "text")],
      "monthly",
    );
    assert.deepEqual(dropped, [label], `expected "${label}" to be dropped`);
  }
});

test("keeps fields that merely MENTION a period", () => {
  // The whole risk of this guard is eating real data. These all carry meaning
  // beyond "which period is this".
  for (const label of [
    "Weekly Deliverable Status",
    "Week of biggest blocker",
    "Monthly revenue",
    "Sprint goal met",
    "Quarterly OKR score",
  ]) {
    const { fields, dropped } = dropPeriodEchoFields(
      [field(label), field("Notes", "text")],
      "weekly",
    );
    assert.deepEqual(dropped, [], `expected "${label}" to be KEPT`);
    assert.equal(fields.length, 2);
  }
});

test("leaves everything alone when the tracker has no cadence", () => {
  // With no cadence there's no period stamp, so "Week" may be the only thing
  // locating the record in time.
  const { fields, dropped } = dropPeriodEchoFields([field("Week")], undefined);
  assert.deepEqual(dropped, []);
  assert.equal(fields.length, 1);
});

test("never strips the tracker down to zero fields", () => {
  const { fields, dropped } = dropPeriodEchoFields([field("Week")], "weekly");
  assert.deepEqual(dropped, [], "a heuristic must not empty the tracker");
  assert.equal(fields.length, 1);
});

// ─── findUngradeableTiers ────────────────────────────────────────────

const STATUS_ONLY_FIELDS = [
  { id: "status", kind: "select", label: "Weekly Deliverable Status" },
  { id: "done", kind: "checkbox", label: "Courses completed" },
];

test("flags a whole-cycle tier when nothing records per-period identity", () => {
  const notes = findUngradeableTiers(
    {
      achieved: "Weekly deliverable completed.",
      roleModel: "All 13 weekly deliverables completed on time.",
    },
    STATUS_ONLY_FIELDS,
  );
  assert.equal(notes.length, 1);
  assert.match(notes[0], /roleModel/);
  assert.match(notes[0], /can't be graded/);
});

test("flags the N-of-N phrasing too", () => {
  const notes = findUngradeableTiers(
    { achieved: "6 of 6 monthly checkpoints delivered." },
    STATUS_ONLY_FIELDS,
  );
  assert.equal(notes.length, 1);
});

test("stays quiet when a field DOES record what each period covered", () => {
  // A text/link/date field can carry which deliverable the period was for, so
  // a whole-cycle bar is at least arguably gradeable — don't cry wolf.
  const notes = findUngradeableTiers(
    { roleModel: "All 13 weekly deliverables completed on time." },
    [...STATUS_ONLY_FIELDS, { id: "ev", kind: "link", label: "Evidence" }],
  );
  assert.deepEqual(notes, []);
});

test("stays quiet on ordinary per-period tiers", () => {
  const notes = findUngradeableTiers(
    {
      notAchieved: "No deliverable logged this week.",
      achieved: "Deliverable completed and coverage >= 80%.",
      overAchieved: "Completed early with evidence linked.",
    },
    STATUS_ONLY_FIELDS,
  );
  assert.deepEqual(notes, []);
});

test("handles a null tier set", () => {
  assert.deepEqual(findUngradeableTiers(null, STATUS_ONLY_FIELDS), []);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  addDetailItem,
  countDetailItems,
  describeCycle,
  detailCapacity,
  insertPeriodAfter,
  isStructuralChange,
  materialisePeriods,
  moveDetailItem,
  removeDetailItem,
  removePeriod,
  resolvePlanBounds,
  setCadence,
  setCycleStart,
  setNestedCadence,
  setPeriodCount,
  stampBounds,
  swapPeriods,
} from "./plan-model.js";

/**
 * The plan editor exists because of one recurring failure: a 13-week plan
 * arriving as 53 weekly cells. `resolvePlanBounds` is where that is caught,
 * so its precedence and its provenance flags are pinned first; the content
 * mutators are pinned for the one property that matters — moving and
 * trimming never lose what the document said.
 */

const NOW = Date.UTC(2026, 8, 16); // Wed 16 Sep 2026

const week = (n, detail) => ({ key: `w${n}`, label: `Week ${n}`, ...(detail ? { detail } : {}) });

// ─── resolvePlanBounds ────────────────────────────────────────────────

test("a flat weekly block with nothing stated is the calendar-year default — and says so", () => {
  const b = resolvePlanBounds({ cadence: "weekly" }, { now: NOW });
  assert.equal(b.startSource, "today");
  assert.equal(b.cycleStart, "2026-09-14", "snaps to the Monday");
  assert.equal(b.lengthSource, "default");
  assert.equal(b.periodCount, 53);
  assert.equal(b.windows.length, 53);
});

test("a stated periodCount bounds a flat block to exactly that many windows", () => {
  const b = resolvePlanBounds({ cadence: "weekly", cycleStart: "2026-09-01", periodCount: 13 }, { now: NOW });
  assert.equal(b.startSource, "spec");
  assert.equal(b.lengthSource, "spec");
  assert.equal(b.periodCount, 13);
  assert.equal(b.cycleEnd, "2026-11-30");
  assert.equal(b.windows.length, 13);
});

test("authored periods outrank a contradicting periodCount and cycleEnd", () => {
  const b = resolvePlanBounds(
    {
      cadence: "weekly",
      cycleStart: "2026-09-01",
      cycleEnd: "2027-08-31",
      periodCount: 53,
      periods: [week(1), week(2), week(3)],
    },
    { now: NOW },
  );
  assert.equal(b.lengthSource, "periods");
  assert.equal(b.periodCount, 3);
  assert.equal(b.cycleEnd, "2026-09-21");
});

test("a stored cycleEnd alone still yields the length", () => {
  const b = resolvePlanBounds({ cadence: "monthly", cycleStart: "2026-08-01", cycleEnd: "2027-01-31" }, { now: NOW });
  assert.equal(b.lengthSource, "spec");
  assert.equal(b.periodCount, 6);
});

test("the goal's own start date anchors a block with none, at the top level", () => {
  const b = resolvePlanBounds({ cadence: "weekly", periodCount: 4 }, { now: NOW, goal: { startDate: "2026-10-05" } });
  assert.equal(b.startSource, "goal");
  assert.equal(b.cycleStart, "2026-10-05");
  assert.equal(b.cycleEnd, "2026-11-01");
});

test("a nested block inherits its containing window for both start and length", () => {
  const q3 = { start: Date.UTC(2026, 6, 1), end: Date.UTC(2026, 9, 1) };
  const b = resolvePlanBounds({ cadence: "weekly" }, { now: NOW, containerStart: q3.start, containerEnd: q3.end });
  assert.equal(b.startSource, "container");
  assert.equal(b.lengthSource, "container");
  assert.equal(b.cycleStart, "2026-07-01");
  assert.equal(b.periodCount, 14, "92 days at a 7-day stride");
});

test("non-bucketing cadences have no plan to map", () => {
  assert.equal(resolvePlanBounds({ cadence: "milestone" }, { now: NOW }), null);
  assert.equal(resolvePlanBounds({}, { now: NOW }), null);
});

test("stampBounds writes the reviewed cycle onto the block, periodCount only when flat", () => {
  const flat = resolvePlanBounds({ cadence: "weekly", cycleStart: "2026-09-01", periodCount: 13 }, { now: NOW });
  const stampedFlat = stampBounds({ cadence: "weekly" }, flat);
  assert.deepEqual(stampedFlat, {
    cadence: "weekly",
    cycleStart: "2026-09-01",
    cycleEnd: "2026-11-30",
    periodCount: 13,
  });
  const authored = { cadence: "weekly", periods: [week(1), week(2)], periodCount: 9 };
  const stamped = stampBounds(authored, resolvePlanBounds(authored, { now: NOW, goal: { startDate: "2026-09-07" } }));
  assert.equal(stamped.periodCount, undefined);
  assert.equal(stamped.cycleStart, "2026-09-07");
  assert.equal(stamped.cycleEnd, "2026-09-20");
});

test("describeCycle reads as a plan, not a config", () => {
  const b = resolvePlanBounds({ cadence: "weekly", cycleStart: "2026-09-01", periodCount: 13 }, { now: NOW });
  assert.equal(describeCycle(b), "13 weeks · 1 Sept – 30 Nov 2026");
});

// ─── cycle mutators ───────────────────────────────────────────────────

test("setPeriodCount pads authored periods with placeholders and re-derives the end", () => {
  const block = { cadence: "weekly", cycleStart: "2026-09-01", periods: [week(1), week(2)] };
  const b = resolvePlanBounds(block, { now: NOW });
  const out = setPeriodCount(block, 4, b);
  assert.equal(out.periods.length, 4);
  assert.deepEqual(out.periods[3], { key: "w4", label: "Week 4" });
  assert.equal(out.cycleEnd, "2026-09-28");
  assert.equal(out.periodCount, undefined);
});

test("setPeriodCount trimming folds the dropped windows' content into the last kept one", () => {
  const block = {
    cadence: "weekly",
    cycleStart: "2026-09-01",
    periods: [
      week(1, { activities: ["Kickoff"] }),
      week(2, { focus: "Charter", activities: ["Write charter"], deliverables: [{ label: "AGENTS.md" }] }),
      week(3, { activities: ["Spec template"], deliverables: [{ label: "spec.md" }] }),
    ],
  };
  const out = setPeriodCount(block, 2, resolvePlanBounds(block, { now: NOW }));
  assert.equal(out.periods.length, 2);
  assert.deepEqual(out.periods[1].detail.activities, ["Write charter", "Spec template"]);
  assert.deepEqual(out.periods[1].detail.deliverables.map((d) => d.label), ["AGENTS.md", "spec.md"]);
  assert.equal(out.periods[1].detail.focus, "Charter");
  assert.equal(out.cycleEnd, "2026-09-14");
});

test("setPeriodCount on a flat block just records the count", () => {
  const out = setPeriodCount({ cadence: "weekly", cycleStart: "2026-09-01" }, 13);
  assert.equal(out.periodCount, 13);
  assert.equal(out.cycleEnd, "2026-11-30");
  assert.equal(out.periods, undefined);
});

test("setPeriodCount clamps to the period ceiling and ignores garbage", () => {
  const block = { cadence: "weekly", cycleStart: "2026-09-01" };
  assert.equal(setPeriodCount(block, 999).periodCount, 53);
  assert.equal(setPeriodCount(block, 0).periodCount, 1);
  assert.equal(setPeriodCount(block, "13"), block);
});

test("setCycleStart keeps the length and moves the end", () => {
  const block = { cadence: "weekly", cycleStart: "2026-09-01", periodCount: 13 };
  const out = setCycleStart(block, "2026-10-05", resolvePlanBounds(block, { now: NOW }));
  assert.equal(out.cycleStart, "2026-10-05");
  assert.equal(out.cycleEnd, "2027-01-03");
  assert.equal(out.periodCount, 13);
});

test("setCadence keeps the window COUNT and recomputes the end for the new stride", () => {
  const block = { cadence: "weekly", cycleStart: "2026-09-01", periodCount: 6 };
  const out = setCadence(block, "monthly", resolvePlanBounds(block, { now: NOW }));
  assert.equal(out.cadence, "monthly");
  assert.equal(out.periodCount, 6);
  assert.equal(out.cycleEnd, "2027-02-28");
});

// ─── content mapping ──────────────────────────────────────────────────

test("moveDetailItem moves an activity between windows, in order, and never past capacity", () => {
  let block = {
    cadence: "weekly",
    periods: [week(1, { activities: ["A", "B"] }), week(2, { activities: ["C"] })],
  };
  block = moveDetailItem(block, { index: 0, kind: "activities", item: 1 }, { index: 1, position: 0 });
  assert.deepEqual(block.periods[0].detail.activities, ["A"]);
  assert.deepEqual(block.periods[1].detail.activities, ["B", "C"]);

  // Fill window 2 to the cap, then try once more.
  for (let i = 0; i < 20; i += 1) block = addDetailItem(block, 1, "activities", `x${i}`);
  assert.equal(detailCapacity(block, 1, "activities"), 0);
  const before = block;
  block = moveDetailItem(block, { index: 0, kind: "activities", item: 0 }, { index: 1 });
  assert.equal(block, before, "a full target is a no-op, not a silent drop");
  assert.deepEqual(block.periods[0].detail.activities, ["A"]);
});

test("moving the last item out of a window tidies its empty detail away", () => {
  let block = { cadence: "weekly", periods: [week(1, { activities: ["A"] }), week(2)] };
  block = moveDetailItem(block, { index: 0, kind: "activities", item: 0 }, { index: 1 });
  assert.equal(block.periods[0].detail, undefined);
  assert.deepEqual(block.periods[1].detail, { activities: ["A"] });
});

test("reordering within one window", () => {
  let block = { cadence: "weekly", periods: [week(1, { activities: ["A", "B", "C"] })] };
  block = moveDetailItem(block, { index: 0, kind: "activities", item: 2 }, { index: 0, position: 0 });
  assert.deepEqual(block.periods[0].detail.activities, ["C", "A", "B"]);
});

test("deliverables keep their format and criteria when moved", () => {
  const d = { label: "Charter", format: "AGENTS.md", criteria: "Signed off" };
  let block = { cadence: "weekly", periods: [week(1, { deliverables: [d] }), week(2)] };
  block = moveDetailItem(block, { index: 0, kind: "deliverables", item: 0 }, { index: 1 });
  assert.deepEqual(block.periods[1].detail.deliverables, [d]);
});

test("add / remove detail items", () => {
  let block = { cadence: "weekly", periods: [week(1)] };
  block = addDetailItem(block, 0, "activities", "  Kickoff  ");
  block = addDetailItem(block, 0, "deliverables", "Charter");
  block = addDetailItem(block, 0, "activities", "   ");
  assert.deepEqual(block.periods[0].detail, { activities: ["Kickoff"], deliverables: [{ label: "Charter" }] });
  block = removeDetailItem(block, 0, "activities", 0);
  assert.deepEqual(block.periods[0].detail, { deliverables: [{ label: "Charter" }] });
  assert.equal(countDetailItems(block), 1);
});

test("materialisePeriods gives a flat block one placeholder per window, once", () => {
  const block = materialisePeriods({ cadence: "monthly", periodCount: 3 }, 3);
  assert.deepEqual(block.periods.map((p) => p.label), ["Month 1", "Month 2", "Month 3"]);
  assert.deepEqual(block.periods.map((p) => p.key), ["m1", "m2", "m3"]);
  assert.equal(block.periodCount, undefined);
  assert.equal(materialisePeriods(block, 9), block);
});

// ─── period structure ─────────────────────────────────────────────────

test("swapPeriods moves whole windows", () => {
  const block = { cadence: "weekly", periods: [week(1), week(2), week(3)] };
  const out = swapPeriods(block, 0, 2);
  assert.deepEqual(out.periods.map((p) => p.key), ["w3", "w2", "w1"]);
  assert.equal(swapPeriods(block, 0, 9), block);
});

test("removePeriod folds the removed window into its predecessor and shortens the cycle", () => {
  const block = {
    cadence: "weekly",
    cycleStart: "2026-09-01",
    periods: [week(1, { activities: ["A"] }), week(2, { activities: ["B"] }), week(3)],
  };
  const out = removePeriod(block, 1, resolvePlanBounds(block, { now: NOW }));
  assert.equal(out.periods.length, 2);
  assert.deepEqual(out.periods[0].detail.activities, ["A", "B"]);
  assert.equal(out.cycleEnd, "2026-09-14");
  // The first window folds forward instead.
  const out2 = removePeriod(block, 0, resolvePlanBounds(block, { now: NOW }));
  assert.deepEqual(out2.periods[0].detail.activities, ["B", "A"]);
  // A single window is never removed.
  const one = { cadence: "weekly", periods: [week(1)] };
  assert.equal(removePeriod(one, 0), one);
});

test("insertPeriodAfter adds a window and lengthens the cycle — even on a flat block", () => {
  const flat = { cadence: "weekly", cycleStart: "2026-09-01", periodCount: 2 };
  const out = insertPeriodAfter(flat, 0, resolvePlanBounds(flat, { now: NOW }));
  assert.equal(out.periods.length, 3);
  assert.equal(out.cycleEnd, "2026-09-21");
  assert.equal(out.periodCount, undefined);
  assert.ok(new Set(out.periods.map((p) => p.key)).size === 3, "keys stay unique");
});

// ─── nesting ──────────────────────────────────────────────────────────

test("setNestedCadence attaches / clears a nested block, materialising a flat one first", () => {
  const flat = { cadence: "quarterly", cycleStart: "2026-07-01", periodCount: 2 };
  const b = resolvePlanBounds(flat, { now: NOW });
  let out = setNestedCadence(flat, 0, "weekly", b);
  assert.equal(out.periods.length, 2);
  assert.deepEqual(out.periods[0].nested, { cadence: "weekly" });
  out = setNestedCadence(out, 0, null, b);
  assert.equal(out.periods[0].nested, undefined);
  assert.equal(setNestedCadence(out, 0, "hourly", b).periods[0].nested, undefined);
});

// ─── diffing ──────────────────────────────────────────────────────────

test("isStructuralChange flags cadence / start / length edits, not content edits", () => {
  const a = { cadence: "weekly", cycleStart: "2026-09-01", cycleEnd: "2026-11-30", periods: [week(1), week(2)] };
  assert.equal(isStructuralChange(a, addDetailItem(a, 0, "activities", "Kickoff")), false);
  assert.equal(isStructuralChange(a, { ...a, cadence: "monthly" }), true);
  assert.equal(isStructuralChange(a, { ...a, cycleStart: "2026-09-08" }), true);
  assert.equal(isStructuralChange(a, { ...a, periods: [week(1)] }), true);
});

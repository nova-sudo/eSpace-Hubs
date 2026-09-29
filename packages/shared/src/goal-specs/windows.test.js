import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCycleWindows,
  cadenceConsistency,
  composedCycleBounds,
  currentPeriodKey,
  specTrackingStart,
  windowKeyAliases,
} from "./windows.js";
import { sunWeekNumberUtc, weekKeyUtc, weekLabelUtc } from "./weeks.js";
import { periodStatuses, summarizeStatuses } from "./assigned-status.js";

const DAY = 86_400_000;
const day = (iso) => Date.parse(`${iso}T00:00:00Z`);
const noon = (iso) => Date.parse(`${iso}T12:00:00Z`);

function weekly2026(extra = {}) {
  return buildCycleWindows({ entries: [], cadence: "weekly", now: noon("2026-09-28"), ...extra });
}

/* ── Decision 1: weekly windows are Sunday-anchored work weeks ───────── */

test("2026 weekly windows start on Sunday; the Thursday 1 Jan week is clipped to Jan 1–3", () => {
  const { windows } = weekly2026();
  assert.equal(windows[0].start, day("2026-01-01"));
  assert.equal(windows[0].end, day("2026-01-04")); // Sun 4 Jan
  assert.equal(windows[0].label, "W01");
  assert.equal(windows[1].start, day("2026-01-04"));
  assert.equal(new Date(windows[1].start).getUTCDay(), 0);
  assert.equal(windows[1].end - windows[1].start, 7 * DAY);
  // Every window after the first starts on a Sunday and is a whole week,
  // except the last, clipped to the cycle's end (Dec 31).
  for (const w of windows.slice(1)) assert.equal(new Date(w.start).getUTCDay(), 0, w.label);
  const last = windows[windows.length - 1];
  assert.equal(last.end, day("2027-01-01"));
  assert.equal(last.label, "W53");
  assert.equal(windows.length, 53);
  // Contiguous, no gaps or overlaps.
  for (let i = 1; i < windows.length; i += 1) assert.equal(windows[i].start, windows[i - 1].end);
});

test("W39 of 2026 is Sun 20 – Sat 26 Sep, keyed 2026-W39 (index = week number for a calendar-year cycle)", () => {
  const w = weekly2026().windows.find((x) => x.label === "W39");
  assert.equal(w.start, day("2026-09-20"));
  assert.equal(w.end, day("2026-09-27"));
  assert.equal(w.key, "2026-W39");
  assert.equal(currentPeriodKey("weekly", noon("2026-09-24")), "2026-W39");
  // Friday/Saturday are the weekend but belong to the week they close.
  assert.equal(currentPeriodKey("weekly", noon("2026-09-26")), "2026-W39");
  assert.equal(currentPeriodKey("weekly", day("2026-09-27")), "2026-W40");
});

test("window labels match the snapshot week label/key (lib/date.js weekLabel/weekKey rule) for a spread of dates", () => {
  // Fixed points documented by lib/date.js: 1 Jan 2026 is week 1, Sun 26
  // Apr 2026 lands in week 18.
  assert.equal(weekLabelUtc(noon("2026-01-01")), "W01");
  assert.equal(weekLabelUtc(noon("2026-01-03")), "W01");
  assert.equal(weekLabelUtc(noon("2026-01-04")), "W02");
  assert.equal(weekLabelUtc(noon("2026-04-26")), "W18");
  assert.equal(weekKeyUtc(noon("2026-09-24")), "W39-2026");
  const { windows } = weekly2026();
  for (let t = day("2026-01-01"); t < day("2027-01-01"); t += 3 * DAY + 5 * 3_600_000) {
    const w = windows.find((x) => t >= x.start && t < x.end);
    assert.ok(w, new Date(t).toISOString());
    assert.equal(w.label, weekLabelUtc(t), new Date(t).toISOString());
    assert.equal(`${w.label}-2026`, weekKeyUtc(t));
    assert.equal(Number(w.label.slice(1)), sunWeekNumberUtc(t));
  }
});

test("other years: numbering restarts at the week containing 1 Jan", () => {
  // 2027 starts on a Friday: W01 = Fri 1 – Sat 2 Jan, W02 starts Sun 3 Jan.
  const c = buildCycleWindows({ entries: [], cadence: "weekly", now: noon("2027-03-01") });
  assert.equal(c.windows[0].end, day("2027-01-03"));
  assert.equal(c.windows[1].label, "W02");
  assert.equal(c.windows[0].key, "2027-W1");
});

test("a mid-year plan keeps index keys but labels its windows by calendar week", () => {
  const spec = { composed: { cadence: "weekly", cycleStart: "2026-09-01", periodCount: 4 } };
  const b = composedCycleBounds(spec);
  const c = buildCycleWindows({ entries: [], cadence: "weekly", now: noon("2026-09-02"), ...b });
  assert.deepEqual(c.windows.map((w) => w.key), ["2026-W1", "2026-W2", "2026-W3", "2026-W4"]);
  assert.deepEqual(c.windows.map((w) => w.label), ["W36", "W37", "W38", "W39"]);
  assert.equal(c.windows[0].start, day("2026-09-01")); // Tue, clipped
  assert.equal(c.windows[1].start, day("2026-09-06")); // Sun
  assert.equal(c.windows[3].end, day("2026-09-27"));
});

test("a stored cycleEnd sized with the old 7-day strides doesn't grow a stub window", () => {
  // 13 weeks from Tue 1 Sep was stamped as Mon 30 Nov under fixed strides.
  const spec = { composed: { cadence: "weekly", cycleStart: "2026-09-01", cycleEnd: "2026-11-30", periodCount: 13 } };
  const b = composedCycleBounds(spec);
  const c = buildCycleWindows({ entries: [], cadence: "weekly", now: noon("2026-09-02"), ...b });
  assert.equal(c.windows.length, 13);
  assert.equal(b.cycleEnd, day("2026-11-29"));
});

test("biweekly pairs Sunday-weeks from the week containing the cycle start", () => {
  const c = buildCycleWindows({ entries: [], cadence: "biweekly", now: noon("2026-06-01") });
  assert.equal(c.windows[0].start, day("2026-01-01"));
  assert.equal(c.windows[0].end, day("2026-01-11"));
  assert.equal(c.windows[0].label, "W01–02");
  assert.equal(c.windows[1].label, "W03–04");
  assert.equal(c.windows[1].key, "2026-B2");
});

test("backfill entries written at a window's midpoint land in that window", () => {
  const { windows } = weekly2026();
  const w = windows.find((x) => x.label === "W12");
  const mid = w.start + Math.floor((w.end - w.start) / 2);
  const c = weekly2026({ entries: [{ ts: mid }] });
  assert.equal(c.windows.find((x) => x.key === w.key).state, "filled");
});

/* ── legacy lock keys ─────────────────────────────────────────────────── */

test("legacy stride lock keys keep settling the window containing the old window's start", () => {
  // Old W39 = Thu 24 – Wed 30 Sep (fixed stride from 1 Jan). Its start lies
  // in the new W39 (Sun 20 – Sat 26 Sep); the key is unchanged, so the lock
  // written under it settles that window with no rewrite.
  const c = weekly2026({ lockedKeys: new Set(["2026-W39", "2026-W3"]) });
  assert.equal(c.windows.find((w) => w.label === "W39").state, "settled");
  assert.equal(c.windows.find((w) => w.label === "W03").state, "settled");
  assert.equal(c.windows.filter((w) => w.state === "settled").length, 2);
});

test("legacy padded 'lock this week' keys (goal-locks currentWindowKey) are read as aliases", () => {
  // currentWindowKey wrote "2026-W05" (zero-padded Sunday week) for week 5.
  const c = weekly2026({ lockedKeys: new Set(["2026-W05"]) });
  assert.equal(c.windows.find((w) => w.label === "W05").state, "settled");
  assert.equal(c.windows.filter((w) => w.state === "settled").length, 1);
});

test("a padded alias never overrides another window's canonical key in a mid-year cycle", () => {
  const spec = { composed: { cadence: "weekly", cycleStart: "2026-09-01", cycleEnd: "2027-08-31" } };
  const b = composedCycleBounds(spec);
  const c = buildCycleWindows({ entries: [], cadence: "weekly", now: noon("2027-09-01"), ...b, lockedKeys: new Set(["2026-W39"]) });
  // Canonical meaning: this cycle's 39th window, not calendar week 39.
  const settled = c.windows.filter((w) => w.state === "settled");
  assert.equal(settled.length, 1);
  assert.equal(settled[0].key, "2026-W39");
  // A padded key that can't be a canonical key of this cycle ("2027-W05" —
  // every key here is 2026-W<n>) IS read as the calendar week it names.
  const keys = new Set(c.windows.map((x) => x.key));
  const w05 = c.windows.find((x) => x.label === "W05 27");
  assert.deepEqual(windowKeyAliases("weekly", w05, keys), ["2027-W05"]);
  const c2 = buildCycleWindows({ entries: [], cadence: "weekly", now: noon("2027-09-01"), ...b, lockedKeys: new Set(["2027-W05"]) });
  assert.equal(c2.windows.find((x) => x.state === "settled").label, "W05 27");
});

test("daily legacy lock keys (YYYY-MM-DD) alias the day window", () => {
  const c = buildCycleWindows({
    entries: [],
    cadence: "daily",
    now: noon("2026-02-10"),
    lockedKeys: new Set(["2026-01-05"]),
  });
  assert.equal(c.windows[4].state, "settled");
});

/* ── Decision 2: a tracker counts from the day it was created ─────────── */

test("windows before the tracker's creation are 'before', not owed, and leave every denominator", () => {
  const spec = { widget: "COUNTER", createdAt: "2026-09-23T10:00:00Z" };
  const b = composedCycleBounds(spec);
  assert.equal(b.trackingStart, Date.parse("2026-09-23T10:00:00Z"));
  const c = weekly2026({ ...b });
  const byLabel = Object.fromEntries(c.windows.map((w) => [w.label, w.state]));
  assert.equal(byLabel.W01, "before");
  assert.equal(byLabel.W38, "before");
  // W39 contains the creation day → tracked (and now owed: it has ended).
  assert.equal(byLabel.W39, "owed");
  assert.equal(byLabel.W40, "current");
  assert.equal(c.beforeCount, 38);
  assert.equal(c.windowCount, 53);
  assert.equal(c.total, 15);
  const consistency = cadenceConsistency(c);
  assert.deepEqual({ ...consistency, ratio: undefined }, { satisfied: 0, missed: 1, due: 1, ratio: undefined });
  // Pace is measured over the counted span only.
  assert.ok(c.expectedPct < 15, String(c.expectedPct));
});

test("a backfilled 'before' window counts as filled (and joins the denominator)", () => {
  const b = { trackingStart: Date.parse("2026-09-23T10:00:00Z") };
  const w5 = weekly2026().windows.find((w) => w.label === "W05");
  const c = weekly2026({ ...b, entries: [{ ts: w5.start + DAY }] });
  assert.equal(c.windows.find((w) => w.label === "W05").state, "filled");
  assert.equal(c.beforeCount, 37);
  assert.equal(c.total, 16);
  assert.equal(c.doneCount, 1);
});

test("specTrackingStart: later of createdAt and hireDate; null when not after the cycle start", () => {
  const cs = day("2026-01-01");
  assert.equal(specTrackingStart({ createdAt: "2026-03-01" }, cs), day("2026-03-01"));
  assert.equal(specTrackingStart({ createdAt: "2026-03-01" }, cs, { hireDate: "2026-05-01" }), day("2026-05-01"));
  assert.equal(specTrackingStart({ createdAt: "2026-06-01", hireDate: "2026-05-01" }, cs), day("2026-06-01"));
  assert.equal(specTrackingStart({ createdAt: "2025-12-01" }, cs), null);
  assert.equal(specTrackingStart({}, cs), null);
  assert.deepEqual(composedCycleBounds({ composed: { cadence: "weekly" } }), {});
});

test("assigned goals: windows ended before the assignment are 'before', not missing", () => {
  const spec = { composed: { cadence: "weekly", cycleStart: "2026-09-06", periodCount: 4, fields: [] } };
  const cells = periodStatuses({ spec, entries: [], now: noon("2026-09-28"), trackingStart: day("2026-09-15") });
  assert.deepEqual(cells.map((c) => c.status), ["before", "missing", "missing", "open"]);
  const s = summarizeStatuses(cells);
  assert.equal(s.before, 1);
  assert.equal(s.due, 2);
});

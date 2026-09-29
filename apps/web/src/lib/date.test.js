import test from "node:test";
import assert from "node:assert/strict";

import {
  compareWeekLabels,
  dueStatus,
  isLegacyWeekLabel,
  normaliseWeekLabel,
  parseWeekLabel,
  shortWeekLabel,
  weekKey,
  weekLabel,
  weekNumber,
  weekRangeFromLabel,
} from "./date.js";

// The DST regression: dayOfYear used to be computed by millisecond
// division, which ran one low for every day inside a DST period — and
// the error flipped the week number exactly on Sundays, so Sunday
// snapshots filed under the previous week and label→range→label
// round-trips weren't stable. These properties hold on any host TZ and
// fail on the old implementation wherever the host observes DST.

test("weekLabel round-trips through weekRangeFromLabel for every day of the year", () => {
  const year = 2026;
  for (let d = new Date(year, 0, 1); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
    const label = weekLabel(d);
    const range = weekRangeFromLabel(`${label}-${year}`);
    assert.ok(range, `no range for ${label}`);
    // The day must fall inside its own week: [Sunday, Sunday+7d).
    const endOfWeek = new Date(range.start);
    endOfWeek.setDate(endOfWeek.getDate() + 7);
    assert.ok(
      d >= range.start && d < endOfWeek,
      `${d.toDateString()} labelled ${label} but week runs ${range.start.toDateString()} +7d`,
    );
    // And the range's own label must agree (stable round-trip).
    assert.equal(range.weekLabel, label, `round-trip drifted for ${d.toDateString()}`);
  }
});

test("consecutive Sundays increment the week number by exactly one", () => {
  const year = 2026;
  // First Sunday of the year.
  const jan1 = new Date(year, 0, 1);
  const sunday = new Date(year, 0, 1 + ((7 - jan1.getDay()) % 7));
  let prev = weekNumber(sunday);
  for (let i = 0; i < 50; i++) {
    sunday.setDate(sunday.getDate() + 7);
    if (sunday.getFullYear() !== year) break;
    const wk = weekNumber(sunday);
    assert.equal(wk, prev + 1, `week jumped at ${sunday.toDateString()}`);
    prev = wk;
  }
});

test("week 1 contains Jan 1, even when Jan 1 is mid-week", () => {
  assert.equal(weekNumber(new Date(2026, 0, 1)), 1); // Thursday
  assert.equal(weekNumber(new Date(2026, 0, 3)), 1); // Saturday
  assert.equal(weekNumber(new Date(2026, 0, 4)), 2); // first Sunday after
  assert.equal(weekLabel(new Date(2026, 0, 4)), "W02");
});

// ─── dueStatus (F4) ──────────────────────────────────────────────────
// The one shared "is this date past?" comparison — every surface that
// renders a dueDate routes through it, so the semantics live here:
// the due day itself is due_soon (still winnable), not overdue.

test("dueStatus classifies overdue / due_soon / ok around a fixed now", () => {
  const now = new Date("2026-09-01T12:00:00Z");
  assert.equal(dueStatus("2026-08-31", now).state, "overdue");
  assert.equal(dueStatus("2026-08-31", now).days, -1);
  assert.equal(dueStatus("2026-09-01", now).state, "due_soon"); // today
  assert.equal(dueStatus("2026-09-01", now).days, 0);
  assert.equal(dueStatus("2026-09-08", now).state, "due_soon"); // 7 days out
  assert.equal(dueStatus("2026-09-09", now).state, "ok"); // 8 days out
});

test("dueStatus returns null for empty or malformed input", () => {
  assert.equal(dueStatus(""), null);
  assert.equal(dueStatus(null), null);
  assert.equal(dueStatus("09/01/2026"), null);
  assert.equal(dueStatus("not-a-date"), null);
});

// ─── week keys (year-qualified snapshot keys) ────────────────────────

test("weekKey is the label plus the calendar year", () => {
  assert.equal(weekKey(new Date(2026, 0, 4)), "W02-2026");
  assert.equal(weekKey(new Date(2027, 0, 5)), "W02-2027");
});

test("normaliseWeekLabel reads legacy year-less labels as the given year", () => {
  assert.equal(normaliseWeekLabel("W9", 2026), "W09-2026");
  assert.equal(normaliseWeekLabel("W36-2025", 2026), "W36-2025");
  assert.equal(normaliseWeekLabel("garbage", 2026), "garbage");
  assert.ok(isLegacyWeekLabel("W36"));
  assert.ok(!isLegacyWeekLabel("W36-2026"));
  assert.deepEqual(parseWeekLabel("W36-2026"), { week: 36, year: 2026 });
  assert.equal(shortWeekLabel("W36-2026"), "W36");
});

test("compareWeekLabels orders by year before week number", () => {
  assert.ok(compareWeekLabels("W53-2025", "W01-2026") < 0);
  assert.ok(compareWeekLabels("W02-2026", "W01-2026") > 0);
  assert.equal(compareWeekLabels("W02-2026", "W02-2026"), 0);
  const sorted = ["W01-2026", "W53-2025", "W02-2026"].sort(compareWeekLabels);
  assert.deepEqual(sorted, ["W53-2025", "W01-2026", "W02-2026"]);
});

// Decision 1 parity: a weekly tracker's cadence windows (shared window model,
// UTC) carry exactly the snapshot store's week label/key for every day.
// Local-noon dates keep the comparison timezone-proof: lib/date reads local
// calendar components, the window model reads UTC ones, and noon is the same
// calendar day in both for any zone within ±11h.
test("weekly cadence windows use the snapshot store's week label and key", async () => {
  const { buildCycleWindows, weekLabelUtc } = await import("@espace-devhub/shared/goal-specs");
  const cycle = buildCycleWindows({ entries: [], cadence: "weekly", now: Date.UTC(2026, 8, 28) });
  for (let m = 0; m < 12; m += 1) {
    for (const dom of [1, 3, 4, 9, 15, 20, 24, 26, 27, 28]) {
      const local = new Date(2026, m, dom, 12);
      const utcNoon = Date.UTC(2026, m, dom, 12);
      const w = cycle.windows.find((x) => utcNoon >= x.start && utcNoon < x.end);
      assert.ok(w, local.toDateString());
      assert.equal(w.label, weekLabel(local), local.toDateString());
      assert.equal(`${w.label}-2026`, weekKey(local), local.toDateString());
      assert.equal(weekLabelUtc(utcNoon), weekLabel(local));
    }
  }
  // "W39" names the same days everywhere: Sun 20 – Sat 26 Sep 2026.
  const w39 = cycle.windows.find((x) => x.label === "W39");
  assert.equal(new Date(w39.start).toISOString().slice(0, 10), "2026-09-20");
  assert.equal(new Date(w39.end - 1).toISOString().slice(0, 10), "2026-09-26");
  assert.equal(weekLabel(new Date(2026, 8, 20, 12)), "W39");
  assert.equal(weekLabel(new Date(2026, 8, 26, 12)), "W39");
});

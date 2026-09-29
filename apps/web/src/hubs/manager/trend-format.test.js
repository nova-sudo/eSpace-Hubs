import test from "node:test";
import assert from "node:assert/strict";

import { latestWeekLine, mergedSeries } from "./trend-format.js";

const pt = (week, merged, goalsTracked = 0, goalsMet = 0) => ({
  week,
  merged,
  goalsTracked,
  goalsMet,
});

test("merged series drops unknown weeks", () => {
  assert.deepEqual(mergedSeries([pt("W1-2026", 2), pt("W2-2026", null), pt("W3-2026", 4)]), [2, 4]);
  assert.deepEqual(mergedSeries(undefined), []);
});

test("latest week line", () => {
  assert.equal(latestWeekLine([]), null);
  assert.equal(latestWeekLine([pt("W38-2026", 5, 4, 3)]), "5 merged PRs · 3 of 4 goals met, W38");
  assert.equal(latestWeekLine([pt("W39-2026", null, 0, 0)]), "Snapshot taken, W39");
  assert.equal(latestWeekLine([pt("W39-2026", 1)]), "1 merged PR, W39");
});

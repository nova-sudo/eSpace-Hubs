import test from "node:test";
import assert from "node:assert/strict";

import { deriveCadenceTiers } from "./cadence-tiers.js";
import { settleScopedLadders } from "./compose-ladders.js";

const CLEAN_TIERS = {
  notAchieved: "Fewer than 10 weekly deliverables shipped",
  achieved: "All 13 weekly deliverables shipped",
  overAchieved: "All 13 shipped, most early",
  roleModel: "All 13 shipped early and documented",
};
const CLEAN_CADENCE = {
  notAchieved: "This week's deliverable missing",
  achieved: "This week's deliverable shipped",
  overAchieved: "Shipped early with notes",
  roleModel: "Shipped early, linked and documented",
};
// Whole-cycle total inside the per-window ladder.
const CROSSED_CADENCE = { ...CLEAN_CADENCE, achieved: "All 13 weekly deliverables shipped" };
// Single-window wording inside the whole-plan ladder.
const CROSSED_TIERS = { ...CLEAN_TIERS, achieved: "This week's deliverable shipped" };

test("clean input: no retry, ladders kept", async () => {
  let calls = 0;
  const out = await settleScopedLadders({
    tiers: CLEAN_TIERS,
    cadenceTiers: CLEAN_CADENCE,
    retry: async () => {
      calls += 1;
      return null;
    },
  });
  assert.equal(calls, 0);
  assert.deepEqual(out, { tiers: CLEAN_TIERS, cadenceTiers: CLEAN_CADENCE, notes: [] });
});

test("retry fixes both: corrected ladders, no notes", async () => {
  let seen: string[] = [];
  const out = await settleScopedLadders({
    tiers: CROSSED_TIERS,
    cadenceTiers: CROSSED_CADENCE,
    retry: async (notes) => {
      seen = notes;
      return { tiers: CLEAN_TIERS, cadenceTiers: CLEAN_CADENCE };
    },
  });
  assert.equal(seen.length, 2);
  assert.deepEqual(out, { tiers: CLEAN_TIERS, cadenceTiers: CLEAN_CADENCE, notes: [] });
});

test("retry still crosses on cadence only: derived cadence, note, tiers kept", async () => {
  const out = await settleScopedLadders({
    tiers: CLEAN_TIERS,
    cadenceTiers: CROSSED_CADENCE,
    retry: async () => ({ tiers: CLEAN_TIERS, cadenceTiers: CROSSED_CADENCE }),
  });
  assert.deepEqual(out.tiers, CLEAN_TIERS);
  assert.deepEqual(out.cadenceTiers, deriveCadenceTiers("COMPOSED", CLEAN_TIERS));
  assert.equal(out.notes.length, 1);
  assert.match(out.notes[0]!, /Per-period bar/);
});

test("retry throws, cadence crossed: first-answer tiers kept, cadence derived", async () => {
  const out = await settleScopedLadders({
    tiers: CLEAN_TIERS,
    cadenceTiers: CROSSED_CADENCE,
    retry: async () => {
      throw new Error("timeout");
    },
  });
  assert.deepEqual(out.tiers, CLEAN_TIERS);
  assert.deepEqual(out.cadenceTiers, deriveCadenceTiers("COMPOSED", CLEAN_TIERS));
  assert.equal(out.notes.length, 1);
});

test("retry throws, only tiers crossed: clean model cadenceTiers kept", async () => {
  const out = await settleScopedLadders({
    tiers: CROSSED_TIERS,
    cadenceTiers: CLEAN_CADENCE,
    retry: async () => {
      throw new Error("timeout");
    },
  });
  assert.deepEqual(out.tiers, CROSSED_TIERS);
  assert.deepEqual(out.cadenceTiers, CLEAN_CADENCE);
  assert.equal(out.notes.length, 1);
  assert.match(out.notes[0]!, /Whole-plan bar/);
});

test("retry skipped (null): first answer handled the same way", async () => {
  const out = await settleScopedLadders({
    tiers: CLEAN_TIERS,
    cadenceTiers: CROSSED_CADENCE,
    retry: async () => null,
  });
  assert.deepEqual(out.cadenceTiers, deriveCadenceTiers("COMPOSED", CLEAN_TIERS));
  assert.equal(out.notes.length, 1);
});

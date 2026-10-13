import test from "node:test";
import assert from "node:assert/strict";

import { editRow, initLadders, ladderPayload, resetLadder } from "./approval-ladders.js";

const item = {
  tiers: { notAchieved: "< 2 talks", achieved: "2 talks", overAchieved: "3 talks", roleModel: null },
  cadenceTiers: { notAchieved: "No notes", achieved: "One note", overAchieved: "Two notes", roleModel: "Mentors" },
  tiersSource: "ai",
};

test("an untouched draft sends no ladders", () => {
  const state = initLadders(item);
  assert.equal(state.source, "ai");
  assert.equal(state.tiers.touched, false);
  assert.equal(state.tiers.rows.roleModel, "");
  assert.equal(state.cadenceTiers.rows.roleModel, "Mentors");
  assert.deepEqual(ladderPayload(state), {});
});

test("a null ladder starts as four blank rows", () => {
  const state = initLadders({ tiers: null, cadenceTiers: null });
  assert.deepEqual(state.tiers.rows, { notAchieved: "", achieved: "", overAchieved: "", roleModel: "" });
  assert.equal(state.source, "ai");
});

test("editing one row touches only that ladder and sends it with blanks as null", () => {
  const before = initLadders(item);
  const state = editRow(before, "tiers", "achieved", "Two talks a year");
  assert.equal(before.tiers.touched, false, "edit is immutable");
  assert.equal(state.tiers.touched, true);
  assert.equal(state.cadenceTiers.touched, false);
  assert.deepEqual(ladderPayload(state), {
    tiers: { notAchieved: "< 2 talks", achieved: "Two talks a year", overAchieved: "3 talks", roleModel: null },
  });
});

test("whitespace-only rows are sent as null", () => {
  const state = editRow(initLadders(item), "cadenceTiers", "roleModel", "   ");
  assert.deepEqual(ladderPayload(state), {
    cadenceTiers: { notAchieved: "No notes", achieved: "One note", overAchieved: "Two notes", roleModel: null },
  });
});

test("reset restores the item's ladder and clears touched", () => {
  const edited = editRow(initLadders(item), "cadenceTiers", "achieved", "Rewritten");
  const state = resetLadder(edited, "cadenceTiers", item);
  assert.equal(state.cadenceTiers.touched, false);
  assert.equal(state.cadenceTiers.rows.achieved, "One note");
  assert.deepEqual(ladderPayload(state), {});
});

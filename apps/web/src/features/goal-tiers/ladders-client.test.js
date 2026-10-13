import test from "node:test";
import assert from "node:assert/strict";

import { gradeRequestBody } from "./goal-tier-store.js";
import { readSpecs, saveSpec, updateSpecTiers } from "../goal-specs/specs-store.js";

const T = { notAchieved: "n", achieved: "a", overAchieved: "o", roleModel: "r" };
const C = { notAchieved: "cn", achieved: "ca", overAchieved: "co", roleModel: "cr" };

test("gradeRequestBody carries scope only when given", () => {
  const base = { goalId: "g1", goalTitle: "Ship", tiers: C, currentData: "data", key: "k1" };
  const windowed = gradeRequestBody({ ...base, periodKey: "2026-W3", scope: "window" });
  assert.equal(windowed.scope, "window");
  assert.equal(windowed.periodKey, "2026-W3");
  assert.equal(windowed.tierHash, "k1");
  assert.deepEqual(windowed.tiers, C);

  const whole = gradeRequestBody(base);
  assert.equal("scope" in whole, false);
  assert.equal(whole.periodKey, undefined);
});

test("updateSpecTiers with only cadenceTiers leaves tiers intact", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const seeded = saveSpec({
      schemaVersion: 1,
      goalId: "g-ladders",
      title: "Ship",
      kind: "manual",
      widget: "COUNTER",
      reasoning: "",
      manual: { cadence: "monthly", prompt: "How many?" },
      tiers: T,
      classifiedAt: Date.now(),
    });
    assert.equal(seeded.ok, true, JSON.stringify(seeded.errors));
    await seeded.persisted;

    const res = updateSpecTiers("g-ladders", { cadenceTiers: C }, true);
    assert.equal(res.ok, true, JSON.stringify(res.errors));
    const stored = readSpecs().specs["g-ladders"];
    assert.deepEqual(stored.tiers, T);
    assert.deepEqual(stored.cadenceTiers, C);
    assert.equal(stored.tiersLocked, true);

    const res2 = updateSpecTiers("g-ladders", { tiers: C }, true);
    assert.equal(res2.ok, true);
    const stored2 = readSpecs().specs["g-ladders"];
    assert.deepEqual(stored2.tiers, C);
    assert.deepEqual(stored2.cadenceTiers, C);
  } finally {
    globalThis.fetch = original;
  }
});

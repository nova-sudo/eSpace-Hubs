import test from "node:test";
import assert from "node:assert/strict";

import { preserveLockedLadders } from "./preserve-locked-ladders.js";

const MANAGER = { notAchieved: "mn", achieved: "ma", overAchieved: "mo", roleModel: "mr" };
const MANAGER_WIN = { notAchieved: "wn", achieved: "wa", overAchieved: "wo", roleModel: "wr" };
const STALE = { notAchieved: "sn", achieved: "sa", overAchieved: "so", roleModel: "sr" };

const lockedStored = { goalId: "g1", title: "Ship", tiers: MANAGER, cadenceTiers: MANAGER_WIN, tiersLocked: true };

test("locked stored + plain save: stored ladders win and the lock is kept", () => {
  const incoming = { goalId: "g1", title: "Ship v2", tiers: STALE, tiersLocked: false };
  const out = preserveLockedLadders(lockedStored, incoming, { tiersEdit: false });
  assert.deepEqual(out.tiers, MANAGER);
  assert.deepEqual(out.cadenceTiers, MANAGER_WIN);
  assert.equal(out.tiersLocked, true);
  // Every other field is still the incoming one.
  assert.equal(out.title, "Ship v2");
});

test("locked stored + plain save without ladders: stored ladders are restored", () => {
  const out = preserveLockedLadders(lockedStored, { goalId: "g1", title: "Ship" }, { tiersEdit: false });
  assert.deepEqual(out.tiers, MANAGER);
  assert.deepEqual(out.cadenceTiers, MANAGER_WIN);
  assert.equal(out.tiersLocked, true);
});

test("locked stored + tiersEdit: incoming wins, including an unlock", () => {
  const incoming = { goalId: "g1", tiers: STALE, cadenceTiers: STALE, tiersLocked: false };
  const out = preserveLockedLadders(lockedStored, incoming, { tiersEdit: true });
  assert.deepEqual(out, incoming);
  assert.equal(out.tiersLocked, false);
});

test("unlocked stored: incoming wins", () => {
  const incoming = { goalId: "g1", tiers: STALE };
  const stored = { ...lockedStored, tiersLocked: false };
  assert.deepEqual(preserveLockedLadders(stored, incoming, { tiersEdit: false }), incoming);
  assert.deepEqual(preserveLockedLadders(null, incoming, { tiersEdit: false }), incoming);
});

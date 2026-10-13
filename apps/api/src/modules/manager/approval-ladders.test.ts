import test from "node:test";
import assert from "node:assert/strict";

import {
  applyApprovedLadders,
  projectApprovalLadders,
} from "./approval-ladders.js";

const T = { notAchieved: "n", achieved: "a", overAchieved: "o", roleModel: "r" };
const C = { notAchieved: "cn", achieved: "ca", overAchieved: "co", roleModel: "cr" };

const spec: Record<string, unknown> = {
  goalId: "g1",
  widget: "COUNTER",
  kind: "manual",
  title: "t",
  reasoning: "r",
  manual: { prompt: "p", cadence: "weekly" },
  tiers: T,
  approval: { status: "pending", submittedAt: 5 },
};

test("untouched approve changes nothing", () => {
  const r = applyApprovedLadders(spec, {});
  assert.deepEqual(r.set, {});
  assert.deepEqual(r.changed, { tiers: false, cadenceTiers: false });
  assert.deepEqual(r.errors, []);
});

test("edited cadence ladder is set with tiersLocked", () => {
  const r = applyApprovedLadders(spec, { cadenceTiers: C });
  assert.deepEqual(r.set, { "spec.cadenceTiers": C, "spec.tiersLocked": true });
  assert.deepEqual(r.changed, { tiers: false, cadenceTiers: true });
  assert.deepEqual(r.errors, []);
});

test("edited whole-cycle ladder is set with tiersLocked", () => {
  const edited = { ...T, achieved: "  ten merged PRs  " };
  const r = applyApprovedLadders(spec, { tiers: edited });
  assert.deepEqual(r.set, {
    "spec.tiers": { ...T, achieved: "ten merged PRs" },
    "spec.tiersLocked": true,
  });
  assert.deepEqual(r.changed, { tiers: true, cadenceTiers: false });
});

test("a ladder resent unchanged is not a change", () => {
  const r = applyApprovedLadders(spec, { tiers: { ...T } });
  assert.deepEqual(r.set, {});
  assert.deepEqual(r.changed, { tiers: false, cadenceTiers: false });
});

test("all-blank ladder is ignored", () => {
  const r = applyApprovedLadders(spec, {
    tiers: { notAchieved: "", achieved: "  ", overAchieved: null, roleModel: undefined },
    cadenceTiers: null,
  });
  assert.deepEqual(r.set, {});
  assert.deepEqual(r.changed, { tiers: false, cadenceTiers: false });
  assert.deepEqual(r.errors, []);
});

test("invalid ladder returns errors, no set", () => {
  const r = applyApprovedLadders(spec, { tiers: "nope" });
  assert.equal(r.errors.length, 1);
  assert.deepEqual(r.set, {});
  assert.deepEqual(r.changed, { tiers: false, cadenceTiers: false });
});

test("a ladder row that isn't text is an error", () => {
  const r = applyApprovedLadders(spec, { cadenceTiers: { ...C, achieved: 3 } });
  assert.equal(r.errors.length, 1);
  assert.deepEqual(r.set, {});
});

test("projectApprovalLadders reports source", () => {
  assert.deepEqual(projectApprovalLadders(spec), {
    tiers: T,
    cadenceTiers: null,
    tiersSource: "ai",
  });
  assert.deepEqual(
    projectApprovalLadders({ ...spec, cadenceTiers: C, tiersLocked: true }),
    { tiers: T, cadenceTiers: C, tiersSource: "user" },
  );
});

test("projectApprovalLadders keeps only text rows", () => {
  const r = projectApprovalLadders({ tiers: { ...T, roleModel: null, junk: 4 } });
  assert.deepEqual(r.tiers, { notAchieved: "n", achieved: "a", overAchieved: "o" });
  assert.equal(projectApprovalLadders({ tiers: "x" }).tiers, null);
});

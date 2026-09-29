import test from "node:test";
import assert from "node:assert/strict";

import { validateSpec } from "./validator.js";

const base = {
  goalId: "g1",
  widget: "COUNTER",
  kind: "manual",
  title: "t",
  reasoning: "r",
  manual: { prompt: "p", cadence: "weekly" },
};

test("approval routing fields round-trip through validateSpec", () => {
  const r = validateSpec({
    ...base,
    approval: { status: "pending", submittedAt: 5, managerName: "  Mona  ", noManager: true },
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.spec.approval, {
    status: "pending",
    submittedAt: 5,
    managerName: "Mona",
    noManager: true,
  });
});

test("auto-approval is preserved with its reason; unknown reasons and junk drop", () => {
  const r = validateSpec({
    ...base,
    approval: { status: "approved", autoApproved: true, autoApprovedReason: "no_manager", junk: 1 },
  });
  assert.deepEqual(r.spec.approval, {
    status: "approved",
    autoApproved: true,
    autoApprovedReason: "no_manager",
  });
  const odd = validateSpec({
    ...base,
    approval: { status: "approved", autoApproved: "yes", autoApprovedReason: "whatever", noManager: 1 },
  });
  assert.deepEqual(odd.spec.approval, { status: "approved" });
});

test("approverScope round-trips for manager / admins; anything else drops", () => {
  const admins = validateSpec({
    ...base,
    approval: { status: "pending", submittedAt: 5, approverScope: "admins", noManager: true },
  });
  assert.deepEqual(admins.spec.approval, {
    status: "pending",
    submittedAt: 5,
    noManager: true,
    approverScope: "admins",
  });
  const junk = validateSpec({ ...base, approval: { status: "pending", approverScope: "hr" } });
  assert.deepEqual(junk.spec.approval, { status: "pending" });
});

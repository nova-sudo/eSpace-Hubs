import test from "node:test";
import assert from "node:assert/strict";

import { AUTO_APPROVED_COPY, approvalOutcome } from "./approval-outcome.js";

test("auto-approval is explicit and never names a manager", () => {
  const o = approvalOutcome(
    { status: "approved", autoApproved: true, reason: "no_manager", submittedAt: 9 },
    { status: "pending", submittedAt: 5 },
  );
  assert.equal(o.approved, true);
  assert.equal(o.autoApproved, true);
  assert.equal(o.managerName, null);
  assert.deepEqual(o.approval, {
    status: "approved",
    submittedAt: 9,
    autoApproved: true,
    autoApprovedReason: "no_manager",
  });
  assert.match(AUTO_APPROVED_COPY, /No manager assigned/);
});

test("pending carries the manager name onto the saved approval", () => {
  const o = approvalOutcome(
    { status: "pending", managerName: "Mona", submittedAt: 9 },
    { status: "pending", submittedAt: 5 },
  );
  assert.equal(o.approved, false);
  assert.equal(o.managerName, "Mona");
  assert.deepEqual(o.approval, { status: "pending", submittedAt: 9, managerName: "Mona" });
});

test("an older / failed response keeps the prior submittedAt and stays pending", () => {
  const o = approvalOutcome(null, { status: "pending", submittedAt: 5 });
  assert.deepEqual(o.approval, { status: "pending", submittedAt: 5 });
  assert.equal(o.managerName, null);
});

test("no manager → pending with the org's admins, never auto-approved", async () => {
  const { ADMIN_APPROVAL_COPY, ADMINS_LABEL } = await import("./approval-outcome.js");
  const o = approvalOutcome(
    {
      status: "pending",
      approverScope: "admins",
      noManager: true,
      managerId: null,
      managerName: null,
      submittedAt: 9,
    },
    { status: "pending", submittedAt: 5 },
  );
  assert.equal(o.approved, false);
  assert.equal(o.autoApproved, false);
  assert.equal(o.toAdmins, true);
  assert.equal(o.managerName, ADMINS_LABEL);
  assert.deepEqual(o.approval, {
    status: "pending",
    submittedAt: 9,
    approverScope: "admins",
    noManager: true,
  });
  assert.match(ADMIN_APPROVAL_COPY, /organisation's admins/);
});

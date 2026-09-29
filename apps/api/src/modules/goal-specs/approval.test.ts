import test from "node:test";
import assert from "node:assert/strict";

import {
  applyComposedGate,
  buildSubmitApprovalResponse,
  isActiveManager,
  managerLabel,
  resolveStoredApproval,
  withApprovalRouting,
} from "./approval.js";

test("managerLabel prefers displayName, falls back to email, else null", () => {
  assert.equal(managerLabel({ displayName: " Mona ", email: "m@x.io" }), "Mona");
  assert.equal(managerLabel({ displayName: "", email: "m@x.io" }), "m@x.io");
  assert.equal(managerLabel({ displayName: null, email: null }), null);
  assert.equal(managerLabel(null), null);
});

test("no manager → stays pending and is routed to the org's admins (never auto-approved)", () => {
  const r = buildSubmitApprovalResponse({ managerId: null, managerName: null, now: 42 });
  assert.deepEqual(r, {
    status: "pending",
    approverScope: "admins",
    managerId: null,
    managerName: null,
    noManager: true,
    submittedAt: 42,
    approval: {
      status: "pending",
      submittedAt: 42,
      approverScope: "admins",
      noManager: true,
    },
  });
  assert.equal("autoApproved" in r, false);
});

test("isActiveManager: missing or disabled managers can't act", () => {
  assert.equal(isActiveManager(null), false);
  assert.equal(isActiveManager(undefined), false);
  assert.equal(isActiveManager({ status: "disabled" }), false);
  assert.equal(isActiveManager({ status: "active" }), true);
  assert.equal(isActiveManager({}), true); // legacy rows without status
});

test("with a manager → pending, named, keeps the stored submittedAt", () => {
  const r = buildSubmitApprovalResponse({
    managerId: "abc",
    managerName: "Mona",
    storedSubmittedAt: 7,
    now: 42,
  });
  assert.equal(r.status, "pending");
  assert.equal(r.approverScope, "manager");
  assert.equal(r.noManager, false);
  assert.equal(r.submittedAt, 7);
  assert.deepEqual(r.approval, {
    status: "pending",
    submittedAt: 7,
    approverScope: "manager",
    managerName: "Mona",
  });
  assert.equal(r.managerName, "Mona");
});

test("a manager with no resolvable name still routes as pending, unnamed", () => {
  const r = buildSubmitApprovalResponse({ managerId: "abc", managerName: null, now: 42 });
  assert.equal(r.status, "pending");
  assert.deepEqual(r.approval, { status: "pending", submittedAt: 42, approverScope: "manager" });
});

test("withApprovalRouting names the current manager on open approvals", () => {
  const spec = { goalId: "g", approval: { status: "pending", submittedAt: 1, noManager: true } };
  assert.deepEqual(withApprovalRouting(spec, "Mona", true).approval, {
    status: "pending",
    submittedAt: 1,
    approverScope: "manager",
    managerName: "Mona",
  });
  // does not mutate
  assert.equal(spec.approval.noManager, true);
});

test("withApprovalRouting routes an open approval with no manager to the admins", () => {
  const spec = { approval: { status: "rejected", managerName: "Old boss" } };
  assert.deepEqual(withApprovalRouting(spec, null, false).approval, {
    status: "rejected",
    approverScope: "admins",
    noManager: true,
  });
});

test("withApprovalRouting leaves approved / absent approvals untouched", () => {
  const approved = { approval: { status: "approved", autoApproved: true } };
  assert.equal(withApprovalRouting(approved, "Mona", true), approved);
  const none = { goalId: "g" };
  assert.equal(withApprovalRouting(none, "Mona", true), none);
});

// ─── resolveStoredApproval: approval is server-owned on PUT (S1) ─────

test("a forged approved block is ignored — nothing stored stays nothing", () => {
  const forged = { status: "approved", reviewedByName: "Mona", reviewedAt: 5, autoApproved: true };
  assert.equal(resolveStoredApproval(null, forged, 100), null);
});

test("a forged approved block can't overwrite a pending approval", () => {
  const stored = { status: "pending", submittedAt: 10, approverScope: "manager" };
  assert.deepEqual(
    resolveStoredApproval(stored, { status: "approved", reviewedBy: "me" }, 100),
    stored,
  );
});

test("a first submission stores pending (future stamps clamped to now)", () => {
  assert.deepEqual(resolveStoredApproval(undefined, { status: "pending", submittedAt: 50 }, 100), {
    status: "pending",
    submittedAt: 50,
  });
  assert.deepEqual(resolveStoredApproval(undefined, { status: "pending", submittedAt: 9e15 }, 100), {
    status: "pending",
    submittedAt: 100,
  });
});

test("the post-submit re-save keeps the stored pending block (routing stamps survive)", () => {
  const stored = { status: "pending", submittedAt: 10, approverScope: "admins", noManager: true };
  assert.equal(resolveStoredApproval(stored, { status: "pending", submittedAt: 10 }, 100), stored);
});

test("a stale pending save after approval doesn't revert the decision", () => {
  const stored = { status: "approved", submittedAt: 10, reviewedBy: "m", reviewedAt: 20 };
  assert.equal(resolveStoredApproval(stored, { status: "pending", submittedAt: 10 }, 100), stored);
  // …nor does one with no stamp at all.
  assert.equal(resolveStoredApproval(stored, { status: "pending" }, 100), stored);
});

test("a stale pending save after a rejection doesn't revert it either", () => {
  const stored = { status: "rejected", submittedAt: 10, reviewedAt: 20, note: "fix it" };
  assert.equal(resolveStoredApproval(stored, { status: "pending", submittedAt: 10 }, 100), stored);
});

test("a legitimate resubmit after rejection goes back to pending", () => {
  const stored = { status: "rejected", submittedAt: 10, reviewedAt: 20, note: "fix it" };
  assert.deepEqual(resolveStoredApproval(stored, { status: "pending", submittedAt: 30 }, 100), {
    status: "pending",
    submittedAt: 30,
  });
});

test("a structural edit of an approved plan resubmits it", () => {
  const stored = { status: "approved", submittedAt: 10, reviewedAt: 20 };
  assert.deepEqual(resolveStoredApproval(stored, { status: "pending", submittedAt: 40 }, 100), {
    status: "pending",
    submittedAt: 40,
  });
});

test("a save with no approval block keeps the stored one", () => {
  const stored = { status: "approved", submittedAt: 10 };
  assert.equal(resolveStoredApproval(stored, undefined, 100), stored);
  assert.equal(resolveStoredApproval(null, undefined, 100), null);
});

// ─── applyComposedGate (server-enforced BYO gate) ──────────────────────

test("gate: a NEW COMPOSED spec with no approval is forced pending", () => {
  const r = applyComposedGate({
    widget: "COMPOSED",
    storedWidget: undefined,
    storedExists: false,
    resolved: null,
    now: 7,
  });
  assert.deepEqual(r, { approval: { status: "pending", submittedAt: 7 }, forced: true });
});

test("gate: replacing a catalogue widget with COMPOSED is a new tracker → forced pending", () => {
  const r = applyComposedGate({
    widget: "COMPOSED",
    storedWidget: "COUNTER",
    storedExists: true,
    resolved: null,
    now: 9,
  });
  assert.equal(r.forced, true);
  assert.equal(r.approval?.status, "pending");
});

test("gate: a client-requested pending passes through unforced (client routes it)", () => {
  const resolved = { status: "pending", submittedAt: 3 };
  const r = applyComposedGate({ widget: "COMPOSED", storedWidget: undefined, storedExists: false, resolved });
  assert.deepEqual(r, { approval: resolved, forced: false });
});

test("gate: a stored decision is kept (resolveStoredApproval owns transitions)", () => {
  const resolved = { status: "approved", submittedAt: 3 };
  const r = applyComposedGate({ widget: "COMPOSED", storedWidget: "COMPOSED", storedExists: true, resolved });
  assert.deepEqual(r, { approval: resolved, forced: false });
});

test("gate exemption: a pre-gate live COMPOSED row is grandfathered", () => {
  const r = applyComposedGate({ widget: "COMPOSED", storedWidget: "COMPOSED", storedExists: true, resolved: null });
  assert.deepEqual(r, { approval: null, forced: false });
});

test("gate exemption: non-COMPOSED widgets are never gated", () => {
  const r = applyComposedGate({ widget: "COUNTER", storedWidget: undefined, storedExists: false, resolved: null });
  assert.deepEqual(r, { approval: null, forced: false });
});

test("gate: a forged approved block on a NEW spec is dropped and the spec is forced pending", () => {
  // resolveStoredApproval ignores a non-pending request → null → gate forces.
  const resolved = resolveStoredApproval(undefined, { status: "approved" }, 5);
  const r = applyComposedGate({ widget: "COMPOSED", storedWidget: undefined, storedExists: false, resolved, now: 5 });
  assert.deepEqual(r, { approval: { status: "pending", submittedAt: 5 }, forced: true });
});

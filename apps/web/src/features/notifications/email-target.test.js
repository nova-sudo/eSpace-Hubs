import test from "node:test";
import assert from "node:assert/strict";

import { EMAIL_SETTINGS, resolveEmailTarget } from "./email-target.js";

const dev = { id: "dev" };
const manager = { id: "manager" };
const admin = { id: "admin" };

test("goal kind → the picked hub's goals page on that goal", () => {
  assert.equal(
    resolveEmailTarget({
      row: { kind: "goal_due_soon", data: { goalId: "g1" } },
      hubs: [dev, manager],
      pick: "dev",
    }),
    "/dev/goals?goal=g1",
  );
});

test("sign-up approval for an admin+dev user lands on the admin hub even when dev was picked", () => {
  assert.equal(
    resolveEmailTarget({ row: { kind: "user_pending_approval" }, hubs: [dev, admin], pick: "dev" }),
    "/admin/users",
  );
});

test("goal approval for a manager+dev user lands on the manager hub", () => {
  assert.equal(
    resolveEmailTarget({ row: { kind: "goal_submitted" }, hubs: [dev, manager], pick: "dev" }),
    "/manager/approvals",
  );
});

test("approvals fall back to the admin hub when the user has no manager hub", () => {
  assert.equal(
    resolveEmailTarget({ row: { kind: "goal_submitted" }, hubs: [dev, admin], pick: "dev" }),
    "/admin/approvals",
  );
});

test("missing row (404) → the inbox", () => {
  assert.equal(resolveEmailTarget({ row: null, hubs: [dev], pick: null }), "/dev/notifications");
});

test("settings sentinel → notification settings", () => {
  assert.equal(
    resolveEmailTarget({ row: EMAIL_SETTINGS, hubs: [dev, manager], primaryHubId: "manager" }),
    "/manager/settings?tab=notifications",
  );
});

test("single-hub user → that hub; stale pick is ignored", () => {
  assert.equal(
    resolveEmailTarget({ row: { kind: "goal_approved", data: {} }, hubs: [dev], pick: "qa" }),
    "/dev/goals",
  );
});

test("no hubs → root (lets the root gate explain)", () => {
  assert.equal(resolveEmailTarget({ row: null, hubs: [] }), "/");
});

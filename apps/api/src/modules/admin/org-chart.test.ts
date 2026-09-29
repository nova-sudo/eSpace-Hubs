import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOrgChart,
  managerAssignmentError,
  needsManager,
  type RosterUser,
} from "./org-chart.js";

function u(
  id: string,
  managerId: string | null,
  extra: Partial<RosterUser> = {},
): RosterUser {
  return {
    id,
    displayName: id.toUpperCase(),
    email: `${id}@x.io`,
    status: "active",
    roles: ["dev"],
    managerId,
    ...extra,
  };
}

const boss = (id: string, managerId: string | null = null, extra: Partial<RosterUser> = {}) =>
  u(id, managerId, { roles: ["manager"], ...extra });

// ─── managerAssignmentError ──────────────────────────────────────────

test("a valid active manager is accepted", () => {
  const roster = [boss("m"), u("a", null)];
  assert.equal(managerAssignmentError("a", "m", roster), null);
});

test("self-assignment is refused", () => {
  assert.match(managerAssignmentError("a", "a", [u("a", null)]) ?? "", /own manager/);
});

test("a manager outside the org (not in the roster) is refused", () => {
  assert.match(managerAssignmentError("a", "zz", [u("a", null)]) ?? "", /not found in this org/);
});

test("disabled, invited and pending accounts can't be managers", () => {
  for (const status of ["disabled", "invited", "pending_admin"]) {
    const roster = [boss("m", null, { status }), u("a", null)];
    assert.match(
      managerAssignmentError("a", "m", roster) ?? "",
      /only an active account can be a manager/,
      status,
    );
  }
});

test("the manager must hold the manager role", () => {
  const roster = [u("m", null), u("a", null)];
  assert.match(managerAssignmentError("a", "m", roster) ?? "", /manager role/);
});

test("A→B→A is refused as a reporting loop", () => {
  // b reports to a; making a report to b closes the loop.
  const roster = [boss("a"), boss("b", "a")];
  const err = managerAssignmentError("a", "b", roster);
  assert.match(err ?? "", /reporting loop: A → B → A/);
});

test("deeper loops are refused too (A→B→C→A)", () => {
  const roster = [boss("a"), boss("b", "a"), boss("c", "b")];
  assert.match(managerAssignmentError("a", "c", roster) ?? "", /A → C → B → A/);
});

test("moving someone under a peer's report is fine (no loop)", () => {
  const roster = [boss("root"), boss("b", "root"), boss("c", "root"), u("d", "c")];
  assert.equal(managerAssignmentError("b", "c", roster), null);
});

test("a pre-existing loop elsewhere doesn't hang or block unrelated moves", () => {
  const roster = [boss("x", "y"), boss("y", "x"), boss("m"), u("a", null)];
  assert.equal(managerAssignmentError("a", "m", roster), null);
});

// ─── buildOrgChart ───────────────────────────────────────────────────

test("builds roots and report lists", () => {
  const chart = buildOrgChart([boss("m"), u("a", "m"), u("b", "m")]);
  assert.deepEqual(chart.rootIds, ["m"]);
  const m = chart.nodes.find((n) => n.id === "m");
  assert.deepEqual(m?.reportIds, ["a", "b"]);
  assert.deepEqual(chart.stats.largestTeam, { managerId: "m", reports: 2 });
});

test("flags devs with no manager, but not admin-only or disabled accounts", () => {
  const chart = buildOrgChart([
    u("dev", null),
    u("adm", null, { roles: ["admin"] }),
    u("gone", null, { status: "disabled" }),
  ]);
  assert.equal(chart.stats.noManager, 1);
  assert.deepEqual(chart.nodes.find((n) => n.id === "dev")?.flags, ["no_manager"]);
  assert.deepEqual(chart.nodes.find((n) => n.id === "adm")?.flags, []);
});

test("counts reports of a disabled manager and managers without the role", () => {
  const chart = buildOrgChart([
    boss("m", null, { status: "disabled" }),
    u("a", "m"),
    u("b", "m", { status: "disabled" }),
    u("x", null, { roles: ["dev"] }),
    u("c", "x"),
  ]);
  assert.equal(chart.stats.disabledManagerReports, 1); // b is disabled itself
  assert.deepEqual(chart.nodes.find((n) => n.id === "a")?.flags, ["manager_disabled"]);
  assert.equal(chart.stats.managerWithoutRole, 1);
  assert.deepEqual(chart.nodes.find((n) => n.id === "c")?.flags, ["manager_not_manager"]);
});

test("a dangling managerId becomes a flagged root", () => {
  const chart = buildOrgChart([u("a", "deleted")]);
  assert.deepEqual(chart.rootIds, ["a"]);
  assert.deepEqual(chart.nodes[0]?.flags, ["manager_missing"]);
  assert.equal(chart.stats.noManager, 1);
});

test("finds each reporting loop once and flags its members", () => {
  const chart = buildOrgChart([boss("a", "c"), boss("b", "a"), boss("c", "b"), u("d", "a")]);
  assert.equal(chart.cycles.length, 1);
  assert.deepEqual([...(chart.cycles[0] ?? [])].sort(), ["a", "b", "c"]);
  for (const id of ["a", "b", "c"]) {
    assert.ok(chart.nodes.find((n) => n.id === id)?.flags.includes("in_cycle"), id);
  }
  assert.equal(chart.nodes.find((n) => n.id === "d")?.flags.includes("in_cycle"), false);
  assert.deepEqual(chart.rootIds, []); // nothing reaches a root
});

test("needsManager: only non-disabled dev/qa", () => {
  assert.equal(needsManager({ status: "active", roles: ["qa"] }), true);
  assert.equal(needsManager({ status: "active", roles: ["manager"] }), false);
  assert.equal(needsManager({ status: "disabled", roles: ["dev"] }), false);
});

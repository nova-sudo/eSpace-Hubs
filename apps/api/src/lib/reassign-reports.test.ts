import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

import { reassignReports, type ReassignReportsDeps } from "./reassign-reports.js";
import { FakeCollection, asCollection } from "./fake-collection.test-support.js";

const orgId = new ObjectId();
const otherOrg = new ObjectId();

function person(name: string, over: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    orgId,
    displayName: name,
    email: `${name.toLowerCase()}@example.com`,
    role: "dev",
    roles: ["dev"],
    status: "active",
    managerId: null as ObjectId | null,
    ...over,
  };
}

function world() {
  const director = person("Dir", { role: "manager", roles: ["manager"] });
  const oldMgr = person("Old", { role: "manager", roles: ["manager"], managerId: director._id });
  const newMgr = person("New", { role: "manager", roles: ["manager", "dev"], managerId: director._id });
  const ana = person("Ana", { managerId: oldMgr._id });
  const bo = person("Bo", { managerId: oldMgr._id, status: "disabled" });
  const cy = person("Cy", { managerId: newMgr._id });
  const dev = person("Dev");
  const outsider = person("Out", { orgId: otherOrg, role: "manager", roles: ["manager"] });
  const users = new FakeCollection([director, oldMgr, newMgr, ana, bo, cy, dev, outsider]);
  const specs = new FakeCollection([
    { orgId, userId: ana._id, goalId: "g1", spec: { title: "Ship X", approval: { status: "pending", managerName: "Old" } } },
    { orgId, userId: ana._id, goalId: "g2", spec: { approval: { status: "approved" } } },
    { orgId, userId: cy._id, goalId: "g3", spec: { approval: { status: "pending", managerName: "New" } } },
  ]);
  const sent: Record<string, unknown>[] = [];
  const deps: ReassignReportsDeps = {
    users: asCollection(users),
    goalSpecs: asCollection(specs),
    notify: async (n) => {
      sent.push(n as unknown as Record<string, unknown>);
      return null;
    },
  };
  return { director, oldMgr, newMgr, ana, bo, cy, dev, outsider, users, specs, sent, deps };
}

const managerOf = (w: ReturnType<typeof world>, id: ObjectId) =>
  w.users.docs.find((u) => u._id.equals(id))?.managerId ?? null;

test("moves every report (disabled too) and re-routes pending approvals", async () => {
  const w = world();
  const r = await reassignReports(
    { orgId, fromManagerId: w.oldMgr._id, toManagerId: w.newMgr._id },
    w.deps,
  );
  assert.deepEqual(new Set(r.reassigned), new Set([w.ana._id.toHexString(), w.bo._id.toHexString()]));
  assert.deepEqual(r.skipped, []);
  assert.ok(managerOf(w, w.ana._id)?.equals(w.newMgr._id));
  assert.ok(managerOf(w, w.bo._id)?.equals(w.newMgr._id));
  assert.ok(managerOf(w, w.cy._id)?.equals(w.newMgr._id), "untouched");

  assert.equal(r.pendingApprovals, 1);
  assert.equal(w.specs.docs[0].spec.approval.managerName, "New");
  assert.equal(w.specs.docs[1].spec.approval.managerName, undefined, "decided approvals untouched");

  assert.equal(w.sent.length, 1);
  assert.ok((w.sent[0].userId as ObjectId).equals(w.newMgr._id));
  assert.equal(w.sent[0].kind, "goal_submitted");
  assert.equal(r.audit.after.managerId, w.newMgr._id.toHexString());
});

test("to = null unassigns and clears the stamped manager name", async () => {
  const w = world();
  const r = await reassignReports(
    { orgId, fromManagerId: w.oldMgr._id, toManagerId: null },
    w.deps,
  );
  assert.equal(r.reassigned.length, 2);
  assert.equal(managerOf(w, w.ana._id), null);
  assert.equal(w.specs.docs[0].spec.approval.managerName, undefined);
  assert.equal(w.specs.docs[0].spec.approval.status, "pending", "still waiting, never auto-approved");
  assert.equal(w.sent.length, 0);
});

test("refuses the same manager, a non-manager, a disabled one, a cross-org one", async () => {
  const w = world();
  const run = (to: ObjectId) =>
    reassignReports({ orgId, fromManagerId: w.oldMgr._id, toManagerId: to }, w.deps);
  await assert.rejects(run(w.oldMgr._id), /different manager/);
  await assert.rejects(run(w.dev._id), /manager role/);
  await assert.rejects(run(w.outsider._id), /isn't in this org/);
  w.users.docs.find((u) => u._id.equals(w.newMgr._id))!.status = "disabled";
  await assert.rejects(run(w.newMgr._id), /isn't active/);
  assert.ok(managerOf(w, w.ana._id)?.equals(w.oldMgr._id), "nothing moved");
});

test("skips the new manager themself and anyone above them (no cycles)", async () => {
  const w = world();
  // Old manager's reports: Ana, and Mid — and the new manager reports to Mid.
  const mid = { ...w.ana, _id: new ObjectId(), displayName: "Mid", managerId: w.oldMgr._id, role: "manager", roles: ["manager"] };
  w.users.docs.push(mid);
  const target = w.users.docs.find((u) => u._id.equals(w.newMgr._id))!;
  target.managerId = mid._id;
  // …and the new manager is also directly under Old.
  const r1 = await reassignReports(
    { orgId, fromManagerId: mid._id, toManagerId: w.newMgr._id },
    w.deps,
  );
  assert.deepEqual(r1.skipped, [{ userId: w.newMgr._id.toHexString(), reason: "is_new_manager" }]);

  const r2 = await reassignReports(
    { orgId, fromManagerId: w.oldMgr._id, toManagerId: w.newMgr._id },
    w.deps,
  );
  assert.deepEqual(r2.skipped, [{ userId: mid._id.toHexString(), reason: "would_create_cycle" }]);
  assert.ok(managerOf(w, mid._id)?.equals(w.oldMgr._id), "Mid stays put");
  assert.ok(managerOf(w, w.ana._id)?.equals(w.newMgr._id));
});

test("a manager with no reports is a no-op", async () => {
  const w = world();
  const r = await reassignReports(
    { orgId, fromManagerId: w.dev._id, toManagerId: w.newMgr._id },
    w.deps,
  );
  assert.deepEqual(r.reassigned, []);
  assert.equal(r.pendingApprovals, 0);
});

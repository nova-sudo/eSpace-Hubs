/**
 * Account approval is retired: any user still parked in `pending_admin`
 * becomes `active` on boot. Idempotent.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import { migratePendingAdminToActive } from "./pending-admin-to-active.js";
import { FakeCollection, asCollection } from "../../lib/fake-collection.test-support.js";

test("pending_admin users become active, others untouched, second run is a no-op", async () => {
  const waiting = new ObjectId();
  const active = new ObjectId();
  const users = new FakeCollection([
    { _id: waiting, status: "pending_admin" },
    { _id: active, status: "active" },
  ]);
  const col = asCollection<any>(users);
  assert.deepEqual(await migratePendingAdminToActive(col), { updated: 1 });
  assert.equal(((await users.findOne({ _id: waiting })) as any).status, "active");
  assert.equal(((await users.findOne({ _id: active })) as any).status, "active");
  assert.deepEqual(await migratePendingAdminToActive(col), { updated: 0 });
});

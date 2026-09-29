import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

import { resolveReportFor, type FindOrgUser } from "./resolve-report.js";
import type { User } from "../../db/types.js";

const orgA = new ObjectId();
const orgB = new ObjectId();
const manager = new ObjectId();
const otherManager = new ObjectId();

function user(over: Partial<User>): User {
  return {
    _id: new ObjectId(),
    orgId: orgA,
    managerId: manager,
    status: "active",
    displayName: "Someone",
    email: "someone@example.com",
    ...over,
  } as User;
}

const mine = user({ displayName: "Mine" });
const stranger = user({ managerId: otherManager });
const unmanaged = user({ managerId: null });
const disabled = user({ status: "disabled" });
const crossOrg = user({ orgId: orgB });
const all = [mine, stranger, unmanaged, disabled, crossOrg];

/** An org-scoped lookup, like `users.findOne({ _id, orgId })`. */
const findUser: FindOrgUser = async ({ _id, orgId }) =>
  all.find((u) => u._id.equals(_id) && u.orgId.equals(orgId)) ?? null;

const session = { orgId: orgA, userId: manager };

async function rejects404(rawId: unknown, find: FindOrgUser = findUser) {
  await assert.rejects(resolveReportFor(session, rawId, find), (err: unknown) => {
    const e = err as { status?: number; statusCode?: number; code?: string };
    assert.equal(e.status ?? e.statusCode, 404);
    return true;
  });
}

test("own active report resolves", async () => {
  const got = await resolveReportFor(session, mine._id.toHexString(), findUser);
  assert.ok(got._id.equals(mine._id));
});

test("a stranger's id (someone else's report) → 404", async () => {
  await rejects404(stranger._id.toHexString());
});

test("a user with no manager → 404", async () => {
  await rejects404(unmanaged._id.toHexString());
});

test("a cross-org id → 404, even though that user's managerId matches", async () => {
  await rejects404(crossOrg._id.toHexString());
});

test("a cross-org row leaking past a broken lookup is still refused", async () => {
  // Belt and braces: the lookup ignores orgId entirely.
  const leaky: FindOrgUser = async ({ _id }) =>
    all.find((u) => u._id.equals(_id)) ?? null;
  await rejects404(crossOrg._id.toHexString(), leaky);
});

test("malformed ids → 404", async () => {
  for (const bad of ["", "nope", "123", "zzzzzzzzzzzzzzzzzzzzzzzz", "abcdefghijkl", undefined, null, 42]) {
    await rejects404(bad);
  }
});

test("an unknown but well-formed id → 404", async () => {
  await rejects404(new ObjectId().toHexString());
});

test("a disabled report → 404 (they've left the roster and the queues)", async () => {
  await rejects404(disabled._id.toHexString());
});

test("the manager themself is not their own report → 404", async () => {
  await rejects404(manager.toHexString());
});

test("no session → 401", async () => {
  await assert.rejects(
    resolveReportFor(null, mine._id.toHexString(), findUser),
    (err: unknown) => {
      const e = err as { status?: number; statusCode?: number };
      assert.equal(e.status ?? e.statusCode, 401);
      return true;
    },
  );
});

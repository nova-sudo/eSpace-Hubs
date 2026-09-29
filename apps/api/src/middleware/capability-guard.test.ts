import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import type { Request, Response } from "express";
import { CAPABILITIES } from "@espace-devhub/shared/capabilities";

import {
  capabilityGuard,
  roleGuard,
  type GuardUser,
  type LoadGuardUser,
} from "./capability-guard.js";
import { HttpError } from "./error-handler.js";

const userId = new ObjectId();
const orgId = new ObjectId();

function reqWithSession(): Request {
  return { session: { userId, orgId } } as unknown as Request;
}

function loaderFor(user: GuardUser | null): LoadGuardUser & { calls: number } {
  const fn = Object.assign(
    async (): Promise<GuardUser | null> => {
      fn.calls += 1;
      return user;
    },
    { calls: 0 },
  );
  return fn;
}

/** Run a middleware and resolve with whatever it passed to next(). */
async function run(
  mw: ReturnType<typeof capabilityGuard>,
  req: Request = reqWithSession(),
): Promise<unknown> {
  return new Promise((resolve) => {
    void mw(req, {} as Response, (err?: unknown) => resolve(err ?? "next"));
  });
}

test("requireCapability allows a user holding every required capability", async () => {
  const mw = capabilityGuard(
    [CAPABILITIES.ADMIN_USERS_MANAGE],
    "all",
    loaderFor({ role: "admin", roles: ["admin"], status: "active" }),
  );
  assert.equal(await run(mw), "next");
});

test("requireCapability denies (403) when a capability is missing", async () => {
  const mw = capabilityGuard(
    [CAPABILITIES.ADMIN_USERS_MANAGE],
    "all",
    loaderFor({ role: "dev", roles: ["dev"], status: "active" }),
  );
  const err = await run(mw);
  assert.ok(err instanceof HttpError);
  assert.equal((err as HttpError).status, 403);
});

test("'all' mode needs every capability; 'any' mode needs one", async () => {
  const manager: GuardUser = { role: "manager", roles: ["manager"], status: "active" };
  const caps = [CAPABILITIES.MANAGER_TEAM_VIEW, CAPABILITIES.ADMIN_AUDIT_VIEW];
  const all = await run(capabilityGuard(caps, "all", loaderFor(manager)));
  assert.equal((all as HttpError).status, 403);
  const any = await run(capabilityGuard(caps, "any", loaderFor(manager)));
  assert.equal(any, "next");
});

test("multi-role users are judged on the union of their roles", async () => {
  // Primary role is admin, but the manager role still grants team view.
  const mw = capabilityGuard(
    [CAPABILITIES.MANAGER_TEAM_VIEW],
    "all",
    loaderFor({ role: "admin", roles: ["admin", "manager"], status: "active" }),
  );
  assert.equal(await run(mw), "next");
});

test("legacy rows without `roles` fall back to the singular role", async () => {
  const mw = capabilityGuard(
    [CAPABILITIES.ADMIN_AUDIT_VIEW],
    "all",
    loaderFor({ role: "admin" }),
  );
  assert.equal(await run(mw), "next");
});

test("a vanished or disabled account is 401, not 403", async () => {
  const gone = await run(
    capabilityGuard([CAPABILITIES.HUB_DEV_ACCESS], "all", loaderFor(null)),
  );
  assert.equal((gone as HttpError).status, 401);
  const disabled = await run(
    capabilityGuard(
      [CAPABILITIES.HUB_DEV_ACCESS],
      "all",
      loaderFor({ role: "dev", roles: ["dev"], status: "disabled" }),
    ),
  );
  assert.equal((disabled as HttpError).status, 401);
});

test("no session is 401 and never touches the loader", async () => {
  const loader = loaderFor({ role: "admin", roles: ["admin"] });
  const err = await run(
    capabilityGuard([CAPABILITIES.HUB_ADMIN_ACCESS], "all", loader),
    {} as Request,
  );
  assert.equal((err as HttpError).status, 401);
  assert.equal(loader.calls, 0);
});

test("guards re-read the user on every request (revocation is immediate)", async () => {
  let current: GuardUser = { role: "admin", roles: ["admin"], status: "active" };
  const loader: LoadGuardUser = async () => current;
  const mw = roleGuard(["admin"], loader);
  assert.equal(await run(mw), "next");
  current = { role: "dev", roles: ["dev"], status: "active" }; // admin revoked
  const err = await run(mw);
  assert.equal((err as HttpError).status, 403);
});

test("roleGuard checks membership across the whole role set", async () => {
  const mw = roleGuard(
    ["admin"],
    loaderFor({ role: "dev", roles: ["dev", "admin"], status: "active" }),
  );
  assert.equal(await run(mw), "next");
});

test("a guard with nothing to require is a programming error", () => {
  assert.throws(() => capabilityGuard([], "all", loaderFor(null)));
  assert.throws(() => roleGuard([], loaderFor(null)));
});

test("loader failures reach next(err) instead of throwing", async () => {
  const boom: LoadGuardUser = async () => {
    throw new Error("db down");
  };
  const err = await run(capabilityGuard([CAPABILITIES.HUB_DEV_ACCESS], "all", boom));
  assert.ok(err instanceof Error);
  assert.equal((err as Error).message, "db down");
});

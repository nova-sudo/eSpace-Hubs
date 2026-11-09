/**
 * Email verification: redeeming the emailed link activates a
 * `pending_email` self-signup and unblocks every session that user
 * already holds (link opened on a phone, laptop session waiting).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import { verifyEmail } from "./email-verification.js";
import { HttpError } from "../../middleware/error-handler.js";
import { FakeCollection, asCollection } from "../../lib/fake-collection.test-support.js";
import type { AuthToken, Session, User } from "../../db/types.js";

const NOW = new Date("2026-11-09T10:00:00Z");

function setup(status: User["status"]) {
  const userId = new ObjectId();
  const users = new FakeCollection([{ _id: userId, email: "a@espace.com.eg", status, emailVerifiedAt: null }]);
  const sessions = new FakeCollection([
    { _id: "s-laptop", userId, emailVerified: false },
    { _id: "s-other", userId: new ObjectId(), emailVerified: false },
  ]);
  const token = { _id: "h", userId, kind: "email_verify" } as unknown as AuthToken;
  const deps = {
    redeem: async (t: string) => (t === "good" ? token : null),
    // "used" = a link that was already redeemed (double click, mail scanner).
    findAny: async (t: string) => (t === "good" || t === "used" ? token : null),
    users: asCollection<any>(users),
    sessions: asCollection<any>(sessions),
    now: () => NOW,
  };
  return { userId, users, sessions, deps };
}

test("valid token activates a pending_email user", async () => {
  const { userId, users, deps } = setup("pending_email");
  const r = await verifyEmail(deps, "good");
  assert.equal(r.status, "verified");
  const u = (await users.findOne({ _id: userId })) as User;
  assert.equal(u.status, "active");
  assert.deepEqual(u.emailVerifiedAt, NOW);
});

test("verify flips every session of the user", async () => {
  const { userId, sessions, deps } = setup("pending_email");
  await verifyEmail(deps, "good");
  const mine = (await sessions.findOne({ _id: "s-laptop" })) as Session;
  const other = (await sessions.findOne({ _id: "s-other" })) as Session;
  assert.equal(mine.emailVerified, true);
  assert.equal(mine.userId.toHexString(), userId.toHexString());
  assert.equal(other.emailVerified, false);
});

test("already active user is a no-op success", async () => {
  const { userId, users, deps } = setup("active");
  const r = await verifyEmail(deps, "good");
  assert.equal(r.status, "already_verified");
  const u = (await users.findOne({ _id: userId })) as User;
  assert.equal(u.emailVerifiedAt, null);
});

test("unknown, used or expired token is invalid_token", async () => {
  const { deps } = setup("pending_email");
  await assert.rejects(
    () => verifyEmail(deps, "bad"),
    (err: unknown) => err instanceof HttpError && err.status === 400 && err.code === "invalid_token",
  );
});

test("disabled user cannot be verified", async () => {
  const { deps } = setup("disabled");
  await assert.rejects(
    () => verifyEmail(deps, "good"),
    (err: unknown) => err instanceof HttpError && err.code === "invalid_token",
  );
});

test("already-used link for a now-active user is already_verified, not an error", async () => {
  const { deps } = setup("active");
  const r = await verifyEmail(deps, "used");
  assert.equal(r.status, "already_verified");
});

test("already-used link for a still-unverified user stays invalid", async () => {
  const { deps } = setup("pending_email");
  await assert.rejects(
    () => verifyEmail(deps, "used"),
    (err: unknown) => err instanceof HttpError && err.code === "invalid_token",
  );
});

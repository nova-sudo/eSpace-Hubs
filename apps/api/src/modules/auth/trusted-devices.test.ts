/**
 * Trusted browsers: after a TOTP success the browser gets a random
 * cookie token; only its sha256 is stored. A live row for the SAME
 * user lets login skip the TOTP prompt for 30 days.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { ObjectId } from "mongodb";
import {
  TRUSTED_DEVICE_TTL_MS,
  checkTrustedDevice,
  countTrustedDevices,
  issueTrustedDevice,
  revokeTrustedDevices,
} from "./trusted-devices.js";
import { FakeCollection, asCollection } from "../../lib/fake-collection.test-support.js";

const T0 = new Date("2026-11-09T10:00:00Z");

function setup() {
  const fake = new FakeCollection();
  const store = asCollection<any>(fake);
  const userId = new ObjectId();
  const orgId = new ObjectId();
  return { fake, store, userId, orgId };
}

test("TTL is 30 days", () => {
  assert.equal(TRUSTED_DEVICE_TTL_MS, 30 * 24 * 60 * 60 * 1000);
});

test("issued token is trusted for the same user and bumps lastUsedAt", async () => {
  const { fake, store, userId, orgId } = setup();
  const token = await issueTrustedDevice(store, { orgId, userId, ip: null, userAgent: "UA", now: T0 });
  const later = new Date(T0.getTime() + 60_000);
  assert.equal(await checkTrustedDevice(store, token, userId, later), true);
  const row = (await fake.findOne({ userId })) as any;
  assert.deepEqual(row.lastUsedAt, later);
});

test("a cookie belonging to another user is not trusted and is kept", async () => {
  const { fake, store, userId, orgId } = setup();
  const token = await issueTrustedDevice(store, { orgId, userId, ip: null, userAgent: null, now: T0 });
  assert.equal(await checkTrustedDevice(store, token, new ObjectId(), T0), false);
  assert.equal(await fake.countDocuments({ userId }), 1);
});

test("an expired row is not trusted", async () => {
  const { store, userId, orgId } = setup();
  const token = await issueTrustedDevice(store, { orgId, userId, ip: null, userAgent: null, now: T0 });
  const after = new Date(T0.getTime() + TRUSTED_DEVICE_TTL_MS + 1);
  assert.equal(await checkTrustedDevice(store, token, userId, after), false);
});

test("revoked after password reset — revokeTrustedDevices ends trust", async () => {
  const { store, userId, orgId } = setup();
  const token = await issueTrustedDevice(store, { orgId, userId, ip: null, userAgent: null, now: T0 });
  assert.equal(await revokeTrustedDevices(store, userId), 1);
  assert.equal(await checkTrustedDevice(store, token, userId, T0), false);
});

test("only the sha256 of the token is stored", async () => {
  const { fake, store, userId, orgId } = setup();
  const token = await issueTrustedDevice(store, { orgId, userId, ip: null, userAgent: null, now: T0 });
  const row = (await fake.findOne({ userId })) as any;
  assert.equal(row.tokenHash, createHash("sha256").update(token).digest("hex"));
  assert.ok(!JSON.stringify(row).includes(token));
});

test("no cookie is never trusted", async () => {
  const { store, userId } = setup();
  assert.equal(await checkTrustedDevice(store, null, userId, T0), false);
});

test("count reflects only live rows", async () => {
  const { store, userId, orgId } = setup();
  await issueTrustedDevice(store, { orgId, userId, ip: null, userAgent: null, now: T0 });
  await issueTrustedDevice(store, { orgId, userId, ip: null, userAgent: null, now: T0 });
  assert.equal(await countTrustedDevices(store, userId, T0), 2);
  const after = new Date(T0.getTime() + TRUSTED_DEVICE_TTL_MS + 1);
  assert.equal(await countTrustedDevices(store, userId, after), 0);
});

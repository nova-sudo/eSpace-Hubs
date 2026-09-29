/**
 * Self-service "move two-factor to a new phone" — start + confirm.
 *
 * No live Mongo in the API suite, so the store is an in-memory fake
 * that honours the filter shapes totp-reenrol.ts and backup-codes.ts
 * send (equality, `$ne`, `$gt`, `$elemMatch` + positional `$set`).
 * TOTP codes are real (otplib via lib/totp.ts); encryption is a
 * reversible stand-in; the password check is a plain comparison.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import { authenticator } from "otplib";
import {
  BACKUP_CODE_COUNT,
  consumeBackupCode,
  countRemainingBackupCodes,
  issueBackupCodes,
  type StoredBackupCode,
} from "./backup-codes.js";
import {
  BACKUP_CODE_SESSION_WINDOW_MS,
  REENROL_PENDING_TTL_MS,
  ReenrolError,
  confirmReenrol,
  startReenrol,
  type ReenrolDeps,
  type ReenrolUser,
} from "./totp-reenrol.js";
import { totpReenrolStartSchema } from "./schemas.js";
import {
  buildProvisioningUri,
  generateTotpSecret,
  verifyTotpCode,
} from "../../lib/totp.js";

const PEPPER = "test-pepper-0123456789abcdef0123456789abcdef";
const PASSWORD = "correct horse battery staple";

type Doc = ReenrolUser & { [k: string]: unknown };

function matches(doc: Doc, filter: Record<string, unknown>): number | boolean {
  let pos: number | boolean = true;
  for (const [k, cond] of Object.entries(filter)) {
    const v = (doc as Record<string, unknown>)[k];
    if (k === "_id") {
      if (!(cond as ObjectId).equals(doc._id)) return false;
    } else if (cond && typeof cond === "object" && "$elemMatch" in cond) {
      const m = (cond as { $elemMatch: StoredBackupCode }).$elemMatch;
      const i = ((v as StoredBackupCode[] | null) ?? []).findIndex(
        (c) => c.hash === m.hash && c.usedAt === m.usedAt,
      );
      if (i < 0) return false;
      pos = i;
    } else if (cond && typeof cond === "object" && "$ne" in cond) {
      if ((v ?? null) === (cond as { $ne: unknown }).$ne) return false;
    } else if (cond && typeof cond === "object" && "$gt" in cond) {
      const gt = (cond as { $gt: Date }).$gt;
      if (!(v instanceof Date) || v.getTime() <= gt.getTime()) return false;
    } else if ((v ?? null) !== cond) {
      return false;
    }
  }
  return pos;
}

function fakeStore(doc: Doc) {
  return {
    doc,
    async findOne(filter: object) {
      return matches(doc, filter as Record<string, unknown>) === false
        ? null
        : // structuredClone drops the ObjectId prototype; keep the real one.
          { ...structuredClone(doc), _id: doc._id };
    },
    async updateOne(filter: object, update: object) {
      const m = matches(doc, filter as Record<string, unknown>);
      if (m === false) return { modifiedCount: 0 };
      const set = (update as { $set: Record<string, unknown> }).$set;
      for (const [k, v] of Object.entries(set)) {
        if (k === "totpBackupCodes.$.usedAt") {
          doc.totpBackupCodes![m as number]!.usedAt = v as Date;
        } else {
          (doc as Record<string, unknown>)[k] = structuredClone(v);
        }
      }
      return { modifiedCount: 1 };
    },
  };
}

/** Reversible "encryption" so the tests can see what is stored. */
const enc = (s: string) => `enc:${s}`;
const dec = (s: string) => {
  if (!s.startsWith("enc:")) throw new Error("bad envelope");
  return s.slice(4);
};

async function setup(opts: { now?: Date } = {}) {
  const liveSecret = generateTotpSecret();
  const doc: Doc = {
    _id: new ObjectId(),
    email: "dev@example.com",
    passwordHash: `hash:${PASSWORD}`,
    totpSecret: enc(liveSecret),
    totpEnrolledAt: new Date("2026-01-01T00:00:00Z"),
    totpPendingSecret: null,
    totpPendingExpiresAt: null,
  };
  const store = fakeStore(doc);
  const oldCodes = await issueBackupCodes(store, doc._id, PEPPER);
  let now = opts.now ?? new Date();
  const deps: ReenrolDeps = {
    store,
    pepper: PEPPER,
    verifyPassword: async (plain, hash) => hash === `hash:${plain}`,
    verifyTotp: verifyTotpCode,
    encrypt: enc,
    decrypt: dec,
    generateSecret: generateTotpSecret,
    provisioningUri: buildProvisioningUri,
    now: () => now,
  };
  return {
    doc,
    store,
    deps,
    liveSecret,
    oldCodes,
    setNow(d: Date) {
      now = d;
    },
  };
}

async function rejectsWith(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof ReenrolError, `expected ReenrolError, got ${String(err)}`);
    assert.equal(err.code, code);
    return true;
  });
}

const noSession = { verifiedWithBackupCodeAt: null };

test("start needs the password AND a valid old factor", async () => {
  const t = await setup();
  const code = authenticator.generate(t.liveSecret);

  // Password alone (no factor, no recent backup-code session) → rejected.
  await rejectsWith(
    startReenrol(t.deps, t.doc._id, { password: PASSWORD }, noSession),
    "factor_required",
  );
  // Right password, wrong authenticator code → rejected.
  const wrong = code === "000000" ? "111111" : "000000";
  await rejectsWith(
    startReenrol(t.deps, t.doc._id, { password: PASSWORD, code: wrong }, noSession),
    "invalid_totp_code",
  );
  // Right password, bogus backup code → rejected.
  await rejectsWith(
    startReenrol(
      t.deps,
      t.doc._id,
      { password: PASSWORD, backupCode: "zzzz-zzzz" },
      noSession,
    ),
    "invalid_backup_code",
  );
  assert.equal(t.doc.totpPendingSecret, null);

  // Both valid → pending secret minted.
  const r = await startReenrol(
    t.deps,
    t.doc._id,
    { password: PASSWORD, code },
    noSession,
  );
  assert.equal(r.factor, "totp");
  assert.match(r.otpauthUrl, /^otpauth:\/\/totp\//);
  assert.equal(t.doc.totpPendingSecret, enc(r.secret));
});

test("wrong password is rejected and does NOT burn the backup code", async () => {
  const t = await setup();
  await rejectsWith(
    startReenrol(
      t.deps,
      t.doc._id,
      { password: "not the password", backupCode: t.oldCodes[0]! },
      noSession,
    ),
    "invalid_password",
  );
  assert.equal(countRemainingBackupCodes(t.doc.totpBackupCodes), BACKUP_CODE_COUNT);
  assert.equal(t.doc.totpPendingSecret, null);
});

test("a backup code used at start is consumed", async () => {
  const t = await setup();
  const r = await startReenrol(
    t.deps,
    t.doc._id,
    { password: PASSWORD, backupCode: t.oldCodes[2]! },
    noSession,
  );
  assert.equal(r.factor, "backup_code");
  assert.equal(r.backupCodesRemaining, BACKUP_CODE_COUNT - 1);
  await rejectsWith(
    startReenrol(
      t.deps,
      t.doc._id,
      { password: PASSWORD, backupCode: t.oldCodes[2]! },
      noSession,
    ),
    "invalid_backup_code",
  );
});

test("the pending secret does not replace the live one until confirm", async () => {
  const t = await setup();
  const liveEnvelope = t.doc.totpSecret;
  const r = await startReenrol(
    t.deps,
    t.doc._id,
    { password: PASSWORD, code: authenticator.generate(t.liveSecret) },
    noSession,
  );
  assert.equal(t.doc.totpSecret, liveEnvelope);
  assert.notEqual(r.secret, t.liveSecret);
  assert.equal(
    t.doc.totpPendingExpiresAt!.getTime(),
    t.deps.now!().getTime() + REENROL_PENDING_TTL_MS,
  );
  // The OLD phone still verifies against the live secret.
  assert.ok(verifyTotpCode(authenticator.generate(t.liveSecret), dec(t.doc.totpSecret!)));
});

test("confirm with a wrong code keeps the old secret and the pending one", async () => {
  const t = await setup();
  const liveEnvelope = t.doc.totpSecret;
  const r = await startReenrol(
    t.deps,
    t.doc._id,
    { password: PASSWORD, code: authenticator.generate(t.liveSecret) },
    noSession,
  );
  // A code from the OLD phone is not a code from the new one.
  const oldPhoneCode = authenticator.generate(t.liveSecret);
  const newPhoneCode = authenticator.generate(r.secret);
  const wrong =
    oldPhoneCode !== newPhoneCode
      ? oldPhoneCode
      : String((Number(newPhoneCode) + 500000) % 1000000).padStart(6, "0");
  await rejectsWith(confirmReenrol(t.deps, t.doc._id, wrong), "invalid_totp_code");
  assert.equal(t.doc.totpSecret, liveEnvelope);
  assert.equal(t.doc.totpPendingSecret, enc(r.secret));
  assert.equal(countRemainingBackupCodes(t.doc.totpBackupCodes), BACKUP_CODE_COUNT);
});

test("confirm swaps the secret, issues new backup codes, old codes fail", async () => {
  const t = await setup();
  const r = await startReenrol(
    t.deps,
    t.doc._id,
    { password: PASSWORD, code: authenticator.generate(t.liveSecret) },
    noSession,
  );
  const out = await confirmReenrol(t.deps, t.doc._id, authenticator.generate(r.secret));

  assert.equal(t.doc.totpSecret, enc(r.secret));
  assert.equal(t.doc.totpPendingSecret, null);
  assert.equal(t.doc.totpPendingExpiresAt, null);
  assert.equal(out.backupCodes.length, BACKUP_CODE_COUNT);
  assert.equal(countRemainingBackupCodes(t.doc.totpBackupCodes), BACKUP_CODE_COUNT);

  for (const c of t.oldCodes) {
    if (out.backupCodes.includes(c)) continue; // 2^-40 collision
    assert.equal(await consumeBackupCode(t.store, t.doc._id, c, PEPPER), null);
  }
  assert.equal(
    await consumeBackupCode(t.store, t.doc._id, out.backupCodes[0]!, PEPPER),
    BACKUP_CODE_COUNT - 1,
  );
  // A second confirm has nothing pending.
  await rejectsWith(
    confirmReenrol(t.deps, t.doc._id, authenticator.generate(r.secret)),
    "reenrol_not_started",
  );
});

test("an expired pending secret is rejected and the old one stays", async () => {
  const t = await setup();
  const liveEnvelope = t.doc.totpSecret;
  const start = t.deps.now!();
  const r = await startReenrol(
    t.deps,
    t.doc._id,
    { password: PASSWORD, code: authenticator.generate(t.liveSecret) },
    noSession,
  );
  t.setNow(new Date(start.getTime() + REENROL_PENDING_TTL_MS + 1000));
  await rejectsWith(
    confirmReenrol(t.deps, t.doc._id, authenticator.generate(r.secret)),
    "reenrol_expired",
  );
  assert.equal(t.doc.totpSecret, liveEnvelope);
});

test("confirm without a start is rejected", async () => {
  const t = await setup();
  await rejectsWith(
    confirmReenrol(t.deps, t.doc._id, authenticator.generate(t.liveSecret)),
    "reenrol_not_started",
  );
});

test("a session verified with a backup code can start within the window, not after", async () => {
  const t = await setup();
  const now = t.deps.now!();
  const recent = {
    verifiedWithBackupCodeAt: new Date(now.getTime() - 60 * 1000),
  };
  const r = await startReenrol(t.deps, t.doc._id, { password: PASSWORD }, recent);
  assert.equal(r.factor, "backup_code_session");
  // No extra backup code was spent.
  assert.equal(countRemainingBackupCodes(t.doc.totpBackupCodes), BACKUP_CODE_COUNT);

  // Still needs the password.
  await rejectsWith(
    startReenrol(t.deps, t.doc._id, { password: "nope nope nope" }, recent),
    "invalid_password",
  );

  const stale = {
    verifiedWithBackupCodeAt: new Date(
      now.getTime() - BACKUP_CODE_SESSION_WINDOW_MS - 1000,
    ),
  };
  await rejectsWith(
    startReenrol(t.deps, t.doc._id, { password: PASSWORD }, stale),
    "factor_required",
  );
});

test("a user without two-factor cannot re-enrol", async () => {
  const t = await setup();
  t.doc.totpEnrolledAt = null;
  await rejectsWith(
    startReenrol(
      t.deps,
      t.doc._id,
      { password: PASSWORD, code: authenticator.generate(t.liveSecret) },
      noSession,
    ),
    "totp_not_enrolled",
  );
});

test("start body: password required, code and backupCode not both", () => {
  assert.ok(totpReenrolStartSchema.safeParse({ password: "x", code: "123456" }).success);
  assert.ok(
    totpReenrolStartSchema.safeParse({ password: "x", backupCode: "ab12-cd34" }).success,
  );
  assert.ok(totpReenrolStartSchema.safeParse({ password: "x" }).success);
  assert.ok(!totpReenrolStartSchema.safeParse({ code: "123456" }).success);
  assert.ok(
    !totpReenrolStartSchema.safeParse({
      password: "x",
      code: "123456",
      backupCode: "ab12-cd34",
    }).success,
  );
  assert.ok(!totpReenrolStartSchema.safeParse({ password: "x", code: "12345" }).success);
});

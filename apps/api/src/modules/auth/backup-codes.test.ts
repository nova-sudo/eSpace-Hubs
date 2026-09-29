/**
 * 2FA backup codes — generation, storage, single-use consumption and
 * regeneration. The API test suite has no live Mongo, so the store is a
 * small in-memory fake that honours the exact filter/update shapes
 * backup-codes.ts sends (`$elemMatch {hash, usedAt: null}` + positional
 * `$set`), which is where single use is enforced.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import {
  BACKUP_CODE_COUNT,
  CLEAR_BACKUP_CODES,
  consumeBackupCode,
  countRemainingBackupCodes,
  generateBackupCodes,
  hashBackupCode,
  issueBackupCodes,
  normalizeBackupCode,
  type BackupCodeStore,
  type StoredBackupCode,
} from "./backup-codes.js";
import { totpLoginVerifySchema } from "./schemas.js";

const PEPPER = "test-pepper-0123456789abcdef0123456789abcdef";

interface FakeUser {
  _id: ObjectId;
  totpBackupCodes?: StoredBackupCode[] | null;
  [k: string]: unknown;
}

function fakeStore(doc: FakeUser): BackupCodeStore & { doc: FakeUser } {
  return {
    doc,
    async findOne(filter: object) {
      const f = filter as { _id: ObjectId };
      return f._id.equals(doc._id) ? structuredClone(doc) : null;
    },
    async updateOne(filter: object, update: object) {
      const f = filter as {
        _id: ObjectId;
        totpBackupCodes?: { $elemMatch: { hash: string; usedAt: null } };
      };
      if (!f._id.equals(doc._id)) return { modifiedCount: 0 };
      let pos = -1;
      if (f.totpBackupCodes) {
        const m = f.totpBackupCodes.$elemMatch;
        pos = (doc.totpBackupCodes ?? []).findIndex(
          (c) => c.hash === m.hash && c.usedAt === m.usedAt,
        );
        if (pos < 0) return { modifiedCount: 0 };
      }
      const set = (update as { $set: Record<string, unknown> }).$set;
      for (const [k, v] of Object.entries(set)) {
        if (k === "totpBackupCodes.$.usedAt") {
          doc.totpBackupCodes![pos]!.usedAt = v as Date;
        } else {
          doc[k] = structuredClone(v);
        }
      }
      return { modifiedCount: 1 };
    },
  };
}

test("generated codes are 10 distinct xxxx-xxxx codes from the unambiguous alphabet", () => {
  const codes = generateBackupCodes();
  assert.equal(codes.length, BACKUP_CODE_COUNT);
  assert.equal(new Set(codes).size, codes.length);
  for (const c of codes) {
    // Crockford lowercase: no i, l, o, u. 8 symbols × 5 bits = 40 bits.
    assert.match(c, /^[0-9a-hjkmnp-tv-z]{4}-[0-9a-hjkmnp-tv-z]{4}$/);
  }
});

test("normalisation tolerates case, spacing and look-alikes, rejects junk", () => {
  assert.equal(normalizeBackupCode("AB12-CD34"), "ab12cd34");
  assert.equal(normalizeBackupCode(" ab12 cd34 "), "ab12cd34");
  assert.equal(normalizeBackupCode("abIL-cdO4"), "ab11cd04");
  assert.equal(normalizeBackupCode("ab12-cd3"), null);
  assert.equal(normalizeBackupCode("ab12-cd3u"), null);
  assert.equal(normalizeBackupCode("123456"), null);
});

test("codes are returned once in plaintext and stored only as keyed hashes", async () => {
  const store = fakeStore({ _id: new ObjectId() });
  const codes = await issueBackupCodes(store, store.doc._id, PEPPER);

  assert.equal(codes.length, BACKUP_CODE_COUNT);
  const stored = store.doc.totpBackupCodes!;
  assert.equal(stored.length, BACKUP_CODE_COUNT);
  const serialized = JSON.stringify(store.doc);
  for (const c of codes) {
    assert.ok(!serialized.includes(c), "plaintext code leaked into storage");
    assert.ok(!serialized.includes(c.replace("-", "")));
  }
  for (const s of stored) {
    assert.match(s.hash, /^[0-9a-f]{64}$/);
    assert.equal(s.usedAt, null);
  }
  // Keyed: the same code under a different key hashes differently.
  const n = normalizeBackupCode(codes[0]!)!;
  assert.notEqual(hashBackupCode(n, PEPPER), hashBackupCode(n, "other-key"));
  // The user shape only ever exposes a count.
  assert.equal(countRemainingBackupCodes(stored), BACKUP_CODE_COUNT);
});

test("a backup code signs in once and fails the second time", async () => {
  const store = fakeStore({ _id: new ObjectId() });
  const codes = await issueBackupCodes(store, store.doc._id, PEPPER);

  const first = await consumeBackupCode(store, store.doc._id, codes[3]!, PEPPER);
  assert.equal(first, BACKUP_CODE_COUNT - 1);
  const again = await consumeBackupCode(store, store.doc._id, codes[3]!, PEPPER);
  assert.equal(again, null);
  // Retyped in upper case is still the same (already spent) code.
  const upper = await consumeBackupCode(
    store,
    store.doc._id,
    codes[3]!.toUpperCase(),
    PEPPER,
  );
  assert.equal(upper, null);
  assert.equal(
    countRemainingBackupCodes(store.doc.totpBackupCodes),
    BACKUP_CODE_COUNT - 1,
  );
});

test("two concurrent uses of one code: exactly one wins", async () => {
  const store = fakeStore({ _id: new ObjectId() });
  const codes = await issueBackupCodes(store, store.doc._id, PEPPER);
  const results = await Promise.all([
    consumeBackupCode(store, store.doc._id, codes[0]!, PEPPER),
    consumeBackupCode(store, store.doc._id, codes[0]!, PEPPER),
  ]);
  assert.equal(results.filter((r) => r !== null).length, 1);
});

test("a wrong or malformed backup code is rejected and consumes nothing", async () => {
  const store = fakeStore({ _id: new ObjectId() });
  await issueBackupCodes(store, store.doc._id, PEPPER);
  assert.equal(
    await consumeBackupCode(store, store.doc._id, "zzzz-zzzz", PEPPER),
    null,
  );
  assert.equal(
    await consumeBackupCode(store, store.doc._id, "not a code", PEPPER),
    null,
  );
  assert.equal(
    countRemainingBackupCodes(store.doc.totpBackupCodes),
    BACKUP_CODE_COUNT,
  );
});

test("a code hashed under a different key does not match", async () => {
  const store = fakeStore({ _id: new ObjectId() });
  const codes = await issueBackupCodes(store, store.doc._id, PEPPER);
  assert.equal(
    await consumeBackupCode(store, store.doc._id, codes[0]!, "rotated-key"),
    null,
  );
});

test("regenerate invalidates every old code", async () => {
  const store = fakeStore({ _id: new ObjectId() });
  const oldCodes = await issueBackupCodes(store, store.doc._id, PEPPER);
  await consumeBackupCode(store, store.doc._id, oldCodes[0]!, PEPPER);

  const newCodes = await issueBackupCodes(store, store.doc._id, PEPPER);
  assert.equal(countRemainingBackupCodes(store.doc.totpBackupCodes), BACKUP_CODE_COUNT);
  for (const c of oldCodes) {
    if (newCodes.includes(c)) continue; // 2^-40 collision — not a failure
    assert.equal(await consumeBackupCode(store, store.doc._id, c, PEPPER), null);
  }
  assert.equal(
    await consumeBackupCode(store, store.doc._id, newCodes[0]!, PEPPER),
    BACKUP_CODE_COUNT - 1,
  );
});

test("clearing codes (2FA reset/disable) leaves nothing to consume", async () => {
  const store = fakeStore({ _id: new ObjectId() });
  const codes = await issueBackupCodes(store, store.doc._id, PEPPER);
  await store.updateOne({ _id: store.doc._id }, { $set: { ...CLEAR_BACKUP_CODES } });
  assert.equal(countRemainingBackupCodes(store.doc.totpBackupCodes), 0);
  assert.equal(await consumeBackupCode(store, store.doc._id, codes[0]!, PEPPER), null);
});

test("login verify body takes exactly one of code / backupCode", () => {
  assert.ok(totpLoginVerifySchema.safeParse({ code: "123456" }).success);
  assert.ok(totpLoginVerifySchema.safeParse({ backupCode: "ab12-cd34" }).success);
  assert.ok(!totpLoginVerifySchema.safeParse({}).success);
  assert.ok(!totpLoginVerifySchema.safeParse({ code: "12345" }).success);
  assert.ok(
    !totpLoginVerifySchema.safeParse({ code: "123456", backupCode: "ab12-cd34" })
      .success,
  );
});

/**
 * Collection accessors + boot-time bootstrap (indexes + Mongo's
 * `$jsonSchema` validators).
 *
 * Why a central registry vs ad-hoc Collection<X> calls at the call site:
 *   - Indexes declared in one place — easy to audit "what's indexed?"
 *   - Validators declared in one place — Mongo's runtime schema stays
 *     aligned with the TS interfaces in ./types.ts
 *   - One boot hook (`bootstrap()`) that the server entry point calls
 *
 * Every accessor returns a typed `Collection<T>`. Never reach for
 * `db.collection("users")` at the call site — go through the accessor
 * so we can swap the underlying name or schema without sweeping.
 */

import type { Collection } from "mongodb";
import { getDb } from "./client.js";
import { logger } from "../lib/logger.js";
import type {
  AuditLogEntry,
  Org,
  Session,
  User,
} from "./types.js";
import { COLLECTION_DEFS } from "./schemas/index.js";

// ─── typed accessors ────────────────────────────────────────────────

export async function getOrgsCollection(): Promise<Collection<Org>> {
  const db = await getDb();
  return db.collection<Org>("orgs");
}

export async function getUsersCollection(): Promise<Collection<User>> {
  const db = await getDb();
  return db.collection<User>("users");
}

export async function getSessionsCollection(): Promise<Collection<Session>> {
  const db = await getDb();
  return db.collection<Session>("sessions");
}

export async function getAuditLogCollection(): Promise<
  Collection<AuditLogEntry>
> {
  const db = await getDb();
  return db.collection<AuditLogEntry>("audit_log");
}

// ─── bootstrap: validators + indexes ─────────────────────────────────

/**
 * Mongo distinguishes "create new collection with options" from
 * "modify existing collection options". This helper picks the right
 * one. Idempotent — safe to call on every boot.
 */
async function ensureValidator(
  name: string,
  validator: (typeof COLLECTION_DEFS)[number]["validator"],
): Promise<void> {
  const db = await getDb();
  const exists =
    (await db.listCollections({ name }, { nameOnly: true }).toArray()).length >
    0;

  if (exists) {
    await db.command({
      collMod: name,
      validator,
      validationLevel: "strict",
      validationAction: "error",
    });
  } else {
    await db.createCollection(name, {
      validator,
      validationLevel: "strict",
      validationAction: "error",
    });
  }
}

async function applyValidators(): Promise<void> {
  for (const { name, validator } of COLLECTION_DEFS) {
    try {
      await ensureValidator(name, validator);
      logger.debug({ collection: name }, "[db] validator aligned");
    } catch (err) {
      logger.error(
        { collection: name, err: err instanceof Error ? err.message : err },
        "[db] validator alignment failed",
      );
      throw err;
    }
  }
}

/**
 * Idempotent — Mongo's `createIndex` is a no-op when the index already
 * exists with matching options.
 *
 * Index design notes:
 *   - Every index is compound on `orgId` first to make per-org isolation
 *     cheap and to align with the multi-tenancy plan (§2.2).
 *   - Sessions get a TTL index on `expiresAt` so Mongo evicts dead
 *     sessions automatically — no cron job needed.
 *   - Audit-log indexes cover the three Admin-dashboard query shapes:
 *     "all activity in time range", "what did this user do", "what
 *     happened to this target".
 */
async function ensureIndexes(): Promise<void> {
  const orgs = await getOrgsCollection();
  await orgs.createIndex({ slug: 1 }, { unique: true, name: "orgs_slug_uniq" });

  const users = await getUsersCollection();
  await users.createIndexes([
    {
      key: { orgId: 1, email: 1 },
      unique: true,
      name: "users_org_email_uniq",
    },
    {
      key: { orgId: 1, managerId: 1 },
      name: "users_org_manager",
    },
    {
      key: { orgId: 1, zohoEmployeeId: 1 },
      unique: true,
      sparse: true,
      name: "users_org_zoho_uniq",
    },
    {
      key: { orgId: 1, status: 1 },
      name: "users_org_status",
    },
  ]);

  const sessions = await getSessionsCollection();
  await sessions.createIndexes([
    { key: { userId: 1 }, name: "sessions_user" },
    {
      key: { expiresAt: 1 },
      // TTL: Mongo deletes the doc once `expiresAt` is in the past.
      // expireAfterSeconds=0 means "compare against the field value
      // itself, not field+offset".
      expireAfterSeconds: 0,
      name: "sessions_ttl",
    },
  ]);

  const auditLog = await getAuditLogCollection();
  await auditLog.createIndexes([
    { key: { orgId: 1, ts: -1 }, name: "audit_org_ts" },
    {
      key: { orgId: 1, actorUserId: 1, ts: -1 },
      name: "audit_org_actor_ts",
    },
    {
      key: { orgId: 1, targetType: 1, targetId: 1, ts: -1 },
      name: "audit_org_target_ts",
    },
  ]);

  logger.debug("[db] indexes ensured for orgs, users, sessions, audit_log");
}

/**
 * One-call boot pipeline. Order matters: we apply validators FIRST
 * (which creates collections if missing) and THEN ensure indexes.
 * Doing it in the other order would force Mongo to apply the validator
 * to an existing collection that may already have rows — fine here
 * since the rows we'd hit were inserted under the same schema, but
 * cleaner to set up the validator before any writes.
 */
export async function bootstrap(): Promise<void> {
  await applyValidators();
  await ensureIndexes();
  logger.info("[db] bootstrap complete (validators + indexes)");
}

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
  AuthToken,
  GoalContextDoc,
  GoalInputEntry,
  GoalSpecRecord,
  GoalTree,
  GradingVerdict,
  HubConfig,
  Integration,
  Org,
  Session,
  Snapshot,
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

export async function getAuthTokensCollection(): Promise<Collection<AuthToken>> {
  const db = await getDb();
  return db.collection<AuthToken>("auth_tokens");
}

export async function getGoalsCollection(): Promise<Collection<GoalTree>> {
  const db = await getDb();
  return db.collection<GoalTree>("goals");
}

export async function getGoalSpecsCollection(): Promise<
  Collection<GoalSpecRecord>
> {
  const db = await getDb();
  return db.collection<GoalSpecRecord>("goal_specs");
}

export async function getGoalContextCollection(): Promise<
  Collection<GoalContextDoc>
> {
  const db = await getDb();
  return db.collection<GoalContextDoc>("goal_context");
}

export async function getGoalInputsCollection(): Promise<
  Collection<GoalInputEntry>
> {
  const db = await getDb();
  return db.collection<GoalInputEntry>("goal_inputs");
}

export async function getSnapshotsCollection(): Promise<Collection<Snapshot>> {
  const db = await getDb();
  return db.collection<Snapshot>("snapshots");
}

export async function getGradingVerdictsCollection(): Promise<
  Collection<GradingVerdict>
> {
  const db = await getDb();
  return db.collection<GradingVerdict>("grading_verdicts");
}

export async function getIntegrationsCollection(): Promise<
  Collection<Integration>
> {
  const db = await getDb();
  return db.collection<Integration>("integrations");
}

export async function getHubConfigsCollection(): Promise<Collection<HubConfig>> {
  const db = await getDb();
  return db.collection<HubConfig>("hub_configs");
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
      // partialFilterExpression (NOT sparse) — Mongo's `sparse:true`
      // only skips MISSING fields, but our docs explicitly persist
      // `zohoEmployeeId: null` for users not yet linked to Zoho. Two
      // such users would collide on the index. The partial filter
      // narrows the index to only docs where zohoEmployeeId is a
      // string (i.e. actually linked).
      partialFilterExpression: { zohoEmployeeId: { $type: "string" } },
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

  const authTokens = await getAuthTokensCollection();
  await authTokens.createIndexes([
    { key: { userId: 1, kind: 1 }, name: "auth_tokens_user_kind" },
    {
      key: { expiresAt: 1 },
      // TTL — Mongo evicts past expiresAt. Means consumed-and-expired
      // rows clean themselves up; the application explicitly deletes
      // on use too, but this is the safety net.
      expireAfterSeconds: 0,
      name: "auth_tokens_ttl",
    },
  ]);

  // ─── M4 collections ───────────────────────────────────────────────
  // Every index leads with orgId so per-tenant queries stay cheap as
  // multi-tenancy unfolds. UNIQUE indexes prevent duplicate writes
  // even if a buggy controller forgets the upsert path.

  const goals = await getGoalsCollection();
  await goals.createIndex(
    { orgId: 1, userId: 1 },
    {
      unique: true,
      name: "goals_org_user_uniq",
      // When M9 adds cycles, extend the key with cycleId — for now
      // there's exactly one tree per (org, user).
    },
  );

  const goalSpecs = await getGoalSpecsCollection();
  await goalSpecs.createIndexes([
    {
      key: { orgId: 1, userId: 1, goalId: 1 },
      unique: true,
      name: "goal_specs_org_user_goal_uniq",
    },
    {
      // Hot path: dashboard load asks "all specs for me" and renders
      // a widget per spec.
      key: { orgId: 1, userId: 1 },
      name: "goal_specs_org_user",
    },
  ]);

  const goalContext = await getGoalContextCollection();
  await goalContext.createIndex(
    { orgId: 1, userId: 1, goalId: 1 },
    { unique: true, name: "goal_context_org_user_goal_uniq" },
  );

  const goalInputs = await getGoalInputsCollection();
  await goalInputs.createIndexes([
    {
      // "All entries for this goal, newest first" — every widget that
      // shows a time series. Compound on (org, user, goal, ts desc)
      // covers the query without an additional scan.
      key: { orgId: 1, userId: 1, goalId: 1, ts: -1 },
      name: "goal_inputs_org_user_goal_ts",
    },
    {
      // "All entries for this user across goals" — backfill / export
      // / activity feed.
      key: { orgId: 1, userId: 1, ts: -1 },
      name: "goal_inputs_org_user_ts",
    },
  ]);

  // ─── M5 collections ───────────────────────────────────────────────

  const snapshots = await getSnapshotsCollection();
  await snapshots.createIndexes([
    {
      // One snapshot per (orgId, userId, week). Manual-wins-over-auto
      // is enforced by the controller; this index just prevents
      // duplicate writes for the same week.
      key: { orgId: 1, userId: 1, week: 1 },
      unique: true,
      name: "snapshots_org_user_week_uniq",
    },
    {
      // "snapshots since date" — dashboards that paginate by capture
      // date instead of week label.
      key: { orgId: 1, userId: 1, capturedAt: -1 },
      name: "snapshots_org_user_captured",
    },
    {
      // Org-wide weekly rollup — LeadHub (M10) reads "all snapshots
      // for week X across the org" without scanning users.
      key: { orgId: 1, week: 1 },
      name: "snapshots_org_week",
    },
  ]);

  const gradingVerdicts = await getGradingVerdictsCollection();
  await gradingVerdicts.createIndexes([
    {
      // Cache lookup key: "have we already graded this PR against this
      // rubric?" Unique so a rubric edit replaces the prior verdict
      // cleanly.
      key: { orgId: 1, userId: 1, prId: 1, rubricHash: 1 },
      unique: true,
      name: "grading_verdicts_pr_rubric_uniq",
    },
    {
      // 180-day TTL — this is a CACHE, not a record. Verdicts the user
      // wants long-term get promoted to evidence (later milestone).
      // 180 days = 15,552,000 seconds.
      key: { gradedAt: 1 },
      expireAfterSeconds: 15_552_000,
      name: "grading_verdicts_ttl",
    },
  ]);

  // ─── M6 collection ────────────────────────────────────────────────

  const integrations = await getIntegrationsCollection();
  await integrations.createIndex(
    { orgId: 1, userId: 1, providerId: 1 },
    {
      unique: true,
      name: "integrations_org_user_provider_uniq",
      // One row per (user, provider). Reconnecting overwrites the
      // existing row — there's only ever one active token per user
      // per provider.
    },
  );

  // ─── M10.5 collection ─────────────────────────────────────────────

  const hubConfigs = await getHubConfigsCollection();
  await hubConfigs.createIndex(
    { orgId: 1, hubId: 1 },
    {
      unique: true,
      name: "hub_configs_org_hub_uniq",
      // One override row per (orgId, hubId). Upsert semantics on the
      // PUT endpoint; missing row means "use shared registry default
      // for everything".
    },
  );

  logger.debug(
    "[db] indexes ensured for orgs, users, sessions, audit_log, auth_tokens, goals, goal_specs, goal_context, goal_inputs, snapshots, grading_verdicts, integrations, hub_configs",
  );
}

/**
 * One-call boot pipeline. Order matters:
 *   1. validators (creates collections if missing)
 *   2. indexes
 *   3. one-shot migrations (e.g. M-CAP roles backfill) — idempotent
 *      and skip-if-already-applied. Failure here is non-fatal.
 *
 * The migration step runs in the background of boot — we kick it off
 * and don't await, so /healthz/readyz turns green as soon as the
 * core DB shape is right. Migration progress lands in the structured
 * log.
 */
export async function bootstrap(): Promise<void> {
  await applyValidators();
  await ensureIndexes();
  logger.info("[db] bootstrap complete (validators + indexes)");
  // Migrations after validators + indexes. We `await` so callers can
  // see counts in their boot logs; migrations are designed to be
  // fast (one updateOne per affected row, bounded by user count).
  await runMigrations();
}

async function runMigrations(): Promise<void> {
  try {
    const { migrateUserRoles } = await import("./migrations/m-cap-roles.js");
    const users = await getUsersCollection();
    const result = await migrateUserRoles(users);
    if (result.scanned > 0) {
      logger.info(
        {
          scanned: result.scanned,
          migrated: result.migrated,
          byOutcome: result.byOutcome,
        },
        "[migrate.m-cap] user roles backfill complete",
      );
    } else {
      logger.debug("[migrate.m-cap] no user rows to migrate");
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[migrate] migration step failed — server still booting, retries on next boot",
    );
  }
}

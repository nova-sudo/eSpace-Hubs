/**
 * Document interfaces for every collection. Single source of truth —
 * each interface here is paired with:
 *
 *   - a $jsonSchema validator in src/db/schemas/<name>.schema.ts that
 *     gives Mongo a defense-in-depth backstop against malformed writes
 *   - a typed accessor in src/db/collections.ts so callers always get
 *     `Collection<User>` rather than `Collection<Document>`
 *   - index declarations in `ensureIndexes()` covering hot read paths
 *
 * If you change a shape here, propagate the change to all three.
 *
 * Note on dates: Mongo stores Date as BSON `Date` natively. We always
 * write `new Date()` from the API, never ISO strings — that keeps
 * range queries cheap and avoids timezone confusion.
 */

import type { ObjectId } from "mongodb";

// ─── orgs ────────────────────────────────────────────────────────────

export interface OrgSettings {
  /**
   * 0 = Sunday, 1 = Monday, … 4 = Thursday. Drives weekly snapshot
   * windowing. Defaults to 0 (Sunday) — week starts Sunday and the
   * dashboard rolls over Thursday EOD per the existing app contract.
   */
  weekStart: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /**
   * Optional cycle definition pre-Zoho. Once Zoho lands, this gets
   * superseded by `performance_cycles` rows.
   */
  performanceCycle?: {
    startMonth: number; // 1-12
    lengthMonths: number;
  };
}

export interface Org {
  _id: ObjectId;
  slug: string; // url-safe id, e.g. "default"
  name: string;
  settings: OrgSettings;
  createdAt: Date;
  updatedAt: Date;
}

// ─── users ───────────────────────────────────────────────────────────

export type UserRole =
  | "admin"
  | "manager"
  | "member"
  | "hr"
  | "qa"
  | "po";

export const ALL_USER_ROLES: readonly UserRole[] = [
  "admin",
  "manager",
  "member",
  "hr",
  "qa",
  "po",
] as const;

export type UserStatus = "invited" | "active" | "disabled";

export const ALL_USER_STATUSES: readonly UserStatus[] = [
  "invited",
  "active",
  "disabled",
] as const;

export interface User {
  _id: ObjectId;
  orgId: ObjectId;
  email: string; // ALWAYS lowercase
  /**
   * Argon2id hash. `null` while the user is in `invited` state — they
   * haven't set a password yet. Becomes a string on first password set.
   */
  passwordHash: string | null;
  role: UserRole;
  status: UserStatus;

  /**
   * TOTP secret, envelope-encrypted at rest. `null` until the user
   * completes 2FA enrolment.
   */
  totpSecret: string | null;
  totpEnrolledAt: Date | null;

  // ─ Zoho-fed fields. All nullable until the M9 Zoho integration lands.
  zohoEmployeeId: string | null;
  managerId: ObjectId | null;
  level: string | null;
  hireDate: Date | null;

  displayName: string;

  // ─ tracking
  createdAt: Date;
  updatedAt: Date;
  invitedBy: ObjectId | null;
  invitedAt: Date | null;
  lastLoginAt: Date | null;
  /**
   * Reset to 0 after a successful login. Used to gate the lockout
   * mechanism in the auth module (M2.3). Living on the user doc keeps
   * the throttle resilient to session loss.
   */
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}

// ─── sessions ────────────────────────────────────────────────────────

export interface Session {
  /**
   * Cryptographically random hex string (32 bytes → 64 chars). NOT an
   * ObjectId — sessions need to look opaque + uniform when shipped in
   * a Set-Cookie header.
   */
  _id: string;
  userId: ObjectId;
  orgId: ObjectId;
  /** Snapshot of the user's role at login time. Refreshed on each
   *  login. Reads avoid an extra users round-trip per request. */
  role: UserRole;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  ip: string | null;
  userAgent: string | null;
  /** Demo mode flips on per-session; doesn't pollute the user doc. */
  demo: boolean;
  /** Whether the second factor was satisfied this session. */
  totpVerified: boolean;
}

// ─── goals (L1 / L2 tree) ────────────────────────────────────────────

/**
 * Schema v2 — matches the localStorage shape in
 * apps/web/src/features/goals/goals-store.js. Stays embedded (l1s →
 * l2s) because the tree is read-mostly and bounded (~5-30 L1s per
 * user), and embedding gives a single round-trip read for every
 * dashboard render.
 *
 * `id` on each L1/L2 is a stable client-side identifier (the original
 * `g-...` uid pattern). We DO NOT use ObjectId for these — they're
 * referenced from goal_specs / goal_context / goal_inputs where
 * stability matters more than DB primacy.
 */

export const GOALS_SCHEMA_VERSION = 2;

export type GoalPriority = "" | "low" | "medium" | "high";
export const ALL_GOAL_PRIORITIES: readonly GoalPriority[] = [
  "",
  "low",
  "medium",
  "high",
];

/**
 * Category vocabulary stays free-form by design — Zoho People imports
 * arbitrary tags. We don't enforce an enum at the DB layer; the UI
 * shows the canonical list (delivery / quality / people / innovation
 * / operations / other) but accepts any string.
 */

export interface GoalL2 {
  id: string;
  code: string; // e.g. "R-L0-3-PSCS-L1-06" from Zoho
  title: string;
  description: string;
  rubric: string;
  weightage: number; // 0-100, weight within parent L1
  priority: GoalPriority;
  /** ISO date YYYY-MM-DD (string, not Date — matches existing shape). */
  startDate: string;
  dueDate: string;
  category: string;
}

export interface GoalL1 {
  id: string;
  code: string;
  title: string;
  description: string;
  rubric: string;
  weightage: number; // 0-100, summed across L1s should equal 100
  category: string;
  l2s: GoalL2[];
}

export interface GoalTree {
  _id: ObjectId;
  orgId: ObjectId;
  userId: ObjectId;
  schemaVersion: typeof GOALS_SCHEMA_VERSION;
  l1s: GoalL1[];
  /**
   * FK to performance_cycles, nullable until M9 (Zoho integration)
   * lands. One goal tree per (user, cycle) — for v1 we treat the
   * cycle as implicit and store a single tree per user.
   */
  cycleId: ObjectId | null;
  updatedAt: Date;
}

// ─── goal specs (AI classifier output) ───────────────────────────────

/**
 * Wraps a ValidatedSpec (from the classifier) with org/user scoping
 * and provenance. The `spec` blob keeps the same shape as the
 * frontend's specs-store so the existing UI consumes API-fetched
 * specs without changes.
 */
export interface GoalSpecRecord {
  _id: ObjectId;
  orgId: ObjectId;
  userId: ObjectId;
  /** Stable goal id (matches GoalL1.id or GoalL2.id). */
  goalId: string;
  /** The validated spec object — see classifier/spec-types.ts. Stored
   *  as a permissive `object` in Mongo; full Zod validation happens
   *  at the route layer. */
  spec: Record<string, unknown>;
  generatedAt: Date;
  /** Free-form provenance tag, e.g. "mistral-medium-latest@2026-05".
   *  Lets us re-classify when the model upgrades. */
  classifierVersion: string | null;
}

// ─── goal context (user answers to spec.context.questions) ───────────

/**
 * Per-goal answer map. The frontend stores the keys as questionIds
 * pointing at strings, string[]s, numbers, or booleans. We store the
 * map opaquely — schema validation happens at the route layer where
 * we know the spec's expected question shape.
 */
export type ContextAnswer = string | number | boolean | string[] | null;

export interface GoalContextDoc {
  _id: ObjectId;
  orgId: ObjectId;
  userId: ObjectId;
  goalId: string;
  answers: Record<string, ContextAnswer>;
  updatedAt: Date;
}

// ─── goal inputs (manual time-series entries) ────────────────────────

/**
 * Append-only time series, one document per entry. Lets us range-query
 * by ts cheaply and supports unbounded history (the localStorage
 * version's `{[goalId]: entries[]}` shape didn't scale).
 *
 * `value` is polymorphic — different manual widgets store different
 * primitive shapes (number for Counter, string for Free-text, object
 * map for Milestone). The route layer normalises before insert.
 */
export type GoalInputValue =
  | number
  | string
  | boolean
  | string[]
  | Record<string, unknown>;

export type GoalInputSource = "manual" | "auto";
export const ALL_GOAL_INPUT_SOURCES: readonly GoalInputSource[] = [
  "manual",
  "auto",
];

export interface GoalInputEntry {
  _id: ObjectId;
  orgId: ObjectId;
  userId: ObjectId;
  goalId: string;
  ts: Date;
  value: GoalInputValue;
  note: string | null;
  source: GoalInputSource;
}

// ─── auth tokens (invites + password resets) ────────────────────────

export type AuthTokenKind = "invite" | "password_reset";

export const ALL_AUTH_TOKEN_KINDS: readonly AuthTokenKind[] = [
  "invite",
  "password_reset",
] as const;

export interface AuthToken {
  /**
   * SHA-256 hash of the plaintext token (base64url, 43 chars). The
   * plaintext goes in the email link; only the hash hits Mongo so a
   * DB-only compromise can't replay live tokens.
   */
  _id: string;
  userId: ObjectId;
  orgId: ObjectId;
  kind: AuthTokenKind;
  createdAt: Date;
  /** TTL — Mongo evicts past this. Index covers it. */
  expiresAt: Date;
  /** Set on first successful redemption; second use rejects. */
  usedAt: Date | null;
  createdByIp: string | null;
  createdByUa: string | null;
}

// ─── audit log ───────────────────────────────────────────────────────

export interface AuditLogEntry {
  _id: ObjectId;
  orgId: ObjectId;
  /** `null` for system-initiated actions (e.g. auto-snapshot). */
  actorUserId: ObjectId | null;
  actorRole: UserRole | null;
  /** Dot-namespaced action verb, e.g. "user.invite", "auth.login". */
  action: string;
  targetType: string | null;
  /** Polymorphic — ObjectId for db-resident targets, string for
   *  external (e.g. PR id). */
  targetId: string | null;
  /** Pre-mutation state. Always redacted of secrets at the call site. */
  before: unknown;
  after: unknown;
  ip: string | null;
  ua: string | null;
  ts: Date;
}

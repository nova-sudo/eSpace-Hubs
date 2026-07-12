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

/**
 * One-shot signup code an admin distributes to people who should be
 * able to self-sign-up against this org. Embedded as an array on the
 * org doc so a single Mongo read during signup gets both org +
 * matching code.
 *
 * Codes are globally unique (enforced at insert by the admin
 * controller). Disabling a code keeps it on the document for
 * audit-log readability — we never hard-delete used codes.
 */
export interface SignupCode {
  /** The plain-text code users type. Indexed via the parent doc. */
  code: string;
  createdAt: Date;
  createdBy: ObjectId;
  /** ISO ms. null = never expires (admin's responsibility). */
  expiresAt: Date | null;
  /** Set to a Date when admin revokes the code. Null = still active. */
  disabledAt: Date | null;
  /** Convenience counter — bumped every successful signup. */
  usedCount: number;
}

export interface Org {
  _id: ObjectId;
  slug: string; // url-safe id, e.g. "default"
  name: string;
  settings: OrgSettings;
  /**
   * Active + retired signup codes. Optional/nullable for migration
   * compatibility with pre-signup orgs; readers default to [].
   */
  signupCodes?: SignupCode[] | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── users ───────────────────────────────────────────────────────────

/**
 * Role ids. `dev` was added in the capability-model migration to
 * replace the generic `member` role for engineers. `member` remains
 * in this union for backward-compat with pre-migration rows; the
 * boot-time migration converts members → devs.
 */
export type UserRole =
  | "admin"
  | "dev"
  | "qa"
  | "manager"
  | "hr"
  | "po"
  | "member";

export const ALL_USER_ROLES: readonly UserRole[] = [
  "admin",
  "dev",
  "qa",
  "manager",
  "hr",
  "po",
  "member",
] as const;

/**
 * `pending_admin` is the self-signup status — the user proved email
 * ownership by knowing the org's signup code, set a password, and (per
 * policy) completed TOTP enrolment + the onboarding form, but admin
 * still hasn't assigned them a role / hub. Login works for these
 * users; they just land on /waiting-approval until admin promotes
 * them to `active`.
 */
export type UserStatus =
  | "invited"
  | "pending_admin"
  | "active"
  | "disabled";

export const ALL_USER_STATUSES: readonly UserStatus[] = [
  "invited",
  "pending_admin",
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
  /**
   * @deprecated Pre-capability-model field. Kept on the user doc for
   * one release as a backward-compatibility shim: readers fall back
   * to `[role]` when `roles` is missing. Boot-time migration writes
   * `roles` for every existing row; new user-creation paths write
   * both `roles` and `role` (the latter is `roles[0]`) until this
   * field is removed in a follow-up.
   *
   * Session resolution + audit log use the FIRST element of the
   * effective roles list as the "primary role" (session.role,
   * audit.actorRole).
   */
  role: UserRole;
  /**
   * Capability-model roles. A user can hold multiple — the
   * orchestrator unions their granted capabilities to decide which
   * hubs they can enter. Optional in the schema for migration
   * compatibility; readers should call `effectiveRoles(u)` which
   * falls back to `[u.role]` when this is missing or empty.
   */
  roles?: UserRole[] | null;
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

  // ─ hubs (M10.1). Both fields are optional on existing rows; readers
  //   apply the DEFAULT_HUB_ID fallback so pre-M10 users keep working.
  //   New user-creation paths (admin-create, invite-accept) populate
  //   them explicitly. M-OB updates them when the user picks a hub.
  /**
   * Hub ids this user is allowed to access. Drives the hub-switcher
   * in the header + the hub-route guard. Empty array would lock the
   * user out of every hub; readers default to [DEFAULT_HUB_ID].
   */
  allowedHubs?: string[] | null;
  /**
   * Default landing hub when the user hits `/`. Must be a member of
   * `allowedHubs`. Defaults to DEFAULT_HUB_ID when missing.
   */
  primaryHub?: string | null;

  // ─ onboarding (M-OB). Profile fields the user fills in once after
  //   first authenticated load. The form resolves `department` →
  //   hub via the shared registry's departments map and updates
  //   `allowedHubs` / `primaryHub` server-side.
  /**
   * Set when the onboarding form is submitted. Null/missing means
   * the user hasn't onboarded yet — AuthGuard traps them at
   * /onboarding regardless of which URL they typed.
   */
  onboardingCompletedAt?: Date | null;
  /**
   * Free-text employee identifier the user types in onboarding.
   * Distinct from `zohoEmployeeId` (canonical, set by Zoho sync in
   * M9) — this is the informal pre-Zoho value.
   */
  employeeId?: string | null;
  /**
   * Department label the user picked. Drives hub assignment at
   * onboarding submit time. Zoho will overwrite once it lands.
   */
  department?: string | null;

  /**
   * C7: synced user preferences — small, additive, self-service
   * (the user edits these about themselves via PATCH /auth/me).
   * Readers apply defaults so pre-C7 rows (missing/null) keep working.
   *   aiProvider     — chat/classify/grade model provider id
   *                    ("anthropic" | "mistral" | "glm" | "openrouter")
   *   lastReviewDate — ISO date of the user's last formal review,
   *                    driving the "Since review" date-range preset.
   *                    "" / absent = unset.
   * Device-local prefs (last-seen marker, active hub pick) deliberately
   * stay in the browser — they're per-device by design.
   */
  prefs?: { aiProvider?: string; lastReviewDate?: string } | null;

  /**
   * Companion-app registration. When set, the Vercel catch-all
   * (apps/web/src/pages/api/v1/[...path].ts) PROXIES every /api/v1/*
   * call for this user to `hostname` instead of running the bundled
   * Express app. Used by Crealogix-engagement users whose backend
   * runs on their own laptop because Vercel can't reach private
   * upstreams like git.bcn.crealogix.net.
   *
   *   hostname        Public DNS the companion-side tunnel exposes
   *                   the local Express server at (e.g.
   *                   "user-42.cf-tunnel.com"). HTTPS implicit.
   *   registeredAt    First time the companion announced itself.
   *   lastSeenAt      Last successful heartbeat. The catch-all
   *                   refuses to proxy to a stale registration
   *                   (older than COMPANION_STALE_AFTER_MS); falls
   *                   back to the bundled API in that case.
   *
   * Optional/nullable on existing rows — backward-compatible with
   * users created before this field shipped.
   */
  companionTunnel?: {
    hostname: string;
    registeredAt: Date;
    lastSeenAt: Date;
  } | null;

  /**
   * Engagement assignment — which client/project this dev's
   * integration credentials resolve to. Each value maps to an
   * `<UPPERCASE>_*` env-var prefix that holds the engagement's
   * OAuth secret, Jira URL, Jenkins creds, etc. (see
   * `apps/api/src/lib/engagement-config.ts`).
   *
   * Optional / nullable on existing rows for backward-compat —
   * readers default to "espace" when missing. Admin can flip a
   * user's engagement via PATCH /api/v1/admin/users/:id.
   *
   * Today's allowed values: "espace" | "crealogix". Adding more
   * engagements later means adding the enum value here, the
   * env-var prefix set, and the route + admin-UI list.
   */
  engagement?: Engagement | null;
}

/**
 * Engagement enum — keep in sync with the env-var prefix set in
 * `apps/api/src/lib/engagement-config.ts` and with the dropdown
 * options in the admin user editor.
 */
export type Engagement = "espace" | "crealogix";

export const ALL_ENGAGEMENTS: readonly Engagement[] = [
  "espace",
  "crealogix",
] as const;

export const DEFAULT_ENGAGEMENT: Engagement = "espace";

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
  /** Whether the second factor was satisfied this session. */
  totpVerified: boolean;
  /**
   * Whether the user had a TOTP secret on record AT SESSION MINT TIME.
   * Set to `true` for sessions minted from an already-enrolled user,
   * `false` for fresh users without enrolment yet. Toggled to `true`
   * when the user completes `/auth/totp/verify-enrolment`.
   *
   * Optional on the type for backward-compat with sessions minted
   * before this field existed — the auth middleware falls back to a
   * one-shot user-lookup + session-backfill when undefined. New
   * `mintSession` calls always write it.
   */
  totpEnrolled?: boolean;
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
  /** The validated spec object — see @espace-devhub/shared/goal-specs.
   *  Stored as a permissive `object` in Mongo; full Zod validation
   *  happens at the route layer. */
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

// ─── snapshots (weekly frozen metrics + per-goal readings) ───────────

/**
 * One snapshot per (orgId, userId, week). Captured Thursday EOD by
 * the auto-snapshotter, optionally re-captured manually with a note.
 *
 * "Manual wins over auto" precedence is enforced by the controller:
 * when `capturedBy === "manual"` exists for a given week, an
 * incoming `capturedBy === "auto"` for the same week is silently
 * ignored. The frontend's saveSnapshot() applies the same rule
 * locally; the server-side check protects against direct API writes.
 *
 * goalReadings is intentionally embedded — every dashboard render
 * reads "snapshot + readings" together, splitting them would force
 * a $lookup join. Inner keys are goalIds and the values match the
 * GoalReading shape below.
 */

export type SnapshotCapturedBy = "auto" | "manual";
export const ALL_SNAPSHOT_CAPTURED_BY: readonly SnapshotCapturedBy[] = [
  "auto",
  "manual",
];

export interface GoalReading {
  /** "weekly" | "monthly" | "quarterly" | … — matches MANUAL_CADENCES. */
  cadence: string;
  /** Bucket id like "W16-2026" / "2026-04" / "2026-Q2". */
  cadenceWindow: string;
  /** What this week added to the cumulative. */
  weekContribution: number | null;
  /** Running total within the cadenceWindow. */
  cumulative: number | null;
  /** Target snapshot at capture time (null if the goal has no target). */
  target: { op: string; value: number } | null;
  /** Sticky for >= goals, recompute for <=. */
  windowMet: boolean | null;
  /** For cumulative goals — are we on pace? */
  onPace: boolean | null;
}

export interface Snapshot {
  _id: ObjectId;
  orgId: ObjectId;
  userId: ObjectId;
  /** Sun-anchored week label, e.g. "W16-2026". */
  week: string;
  capturedAt: Date;
  capturedBy: SnapshotCapturedBy;

  // Headline metrics — v1 fields, still authoritative.
  merged: number;
  reviews: number;
  turnaround: number;
  linkage: number;
  rounds: number;
  note: string;

  goalReadings: Record<string, GoalReading>;

  /** True when one or more integration sources were unavailable. */
  partial: boolean;
  /** Names of missing sources, e.g. ["github", "jira"]. */
  gaps: string[];
}

// ─── grading verdicts (PR rubric grade cache) ────────────────────────

/**
 * Cache of AI-graded PR verdicts, keyed by (prId, rubricHash). Same
 * goal as the localStorage version: never re-grade an unchanged PR
 * against an unchanged rubric.
 *
 * The key insight: this is a cache, not a record. The 180-day TTL on
 * `gradedAt` lets Mongo evict stale entries automatically — when a
 * user comes back to a year-old PR they'll just re-grade it (cost:
 * one Mistral call). M-later raises the TTL once we observe real
 * usage.
 */

export interface GradingVerdictBody {
  pass: boolean;
  reasoning: string;
  violations: string[];
}

export interface GradingVerdict {
  _id: ObjectId;
  orgId: ObjectId;
  userId: ObjectId;
  /** PR identifier — string for cross-provider safety (GitHub uses
   *  numbers, GitLab uses iid+project, future ones who knows). */
  prId: string;
  rubricHash: string;
  verdict: GradingVerdictBody;
  gradedAt: Date;
  /** Echoed for ops / debugging / "this verdict is stale" UX. */
  model: string | null;
  provider: string | null;
}

export type GoalTier =
  | "not_achieved"
  | "achieved"
  | "over_achieved"
  | "role_model";

export interface GoalTierVerdictBody {
  tier: GoalTier;
  reasoning: string;
  confidence: "high" | "medium" | "low";
}

/**
 * Durable cache of a goal's AI achievement-tier verdict, keyed per goal by a
 * `tierHash` of the graded inputs. One row per (orgId, userId, goalId) — a data
 * change bumps the hash and the row is upserted. 180-day TTL on `gradedAt`.
 */
export interface GoalTierVerdict {
  _id: ObjectId;
  orgId: ObjectId;
  userId: ObjectId;
  goalId: string;
  tierHash: string;
  verdict: GoalTierVerdictBody;
  gradedAt: Date;
  model: string | null;
  provider: string | null;
}

// ─── evidence (user-starred review artifacts) ───────────────────────

/**
 * One row per artifact the user explicitly starred for their review
 * export. Per-user scoped; an artifact (PR / ticket) starred by user A
 * is invisible to user B even within the same org. Typical scale: 5–20
 * items per user per review cycle.
 *
 * `id` is the artifact's stable identifier — usually the upstream
 * provider's primary key prefixed with the kind:
 *   "mr-12345"     (GitHub PR / GitLab MR)
 *   "ticket-PROJ-42" (Jira ticket)
 *   "review-…"     (review comment cluster)
 * The unique (orgId, userId, id) index dedupes re-stars.
 */

export const ALL_EVIDENCE_KINDS = ["merged-pr", "ticket", "review"] as const;
export type EvidenceKind = (typeof ALL_EVIDENCE_KINDS)[number];

export interface EvidenceItem {
  _id: ObjectId;
  orgId: ObjectId;
  userId: ObjectId;
  /** Stable artifact id — see header doc for format. */
  id: string;
  kind: EvidenceKind;
  /** Display ref shown in the UI ("!456", "PROJ-42"). */
  ref: string;
  /** Human-readable title from the upstream artifact. */
  title: string;
  /** Display date string (already pre-formatted by the frontend). */
  date: string;
  /** Optional user-written impact note. Empty string when unused. */
  impact: string;
  starredAt: Date;
}

// ─── integrations (per-user provider tokens) ────────────────────────

/**
 * One row per (orgId, userId, providerId). The token bytes are
 * NEVER stored in the clear — `encryptedToken`, `encryptedApiToken`,
 * and `refreshToken` are envelope-encrypted via crypto-secret.ts
 * (AES-256-GCM, key derived from INTEGRATION_TOKEN_KEY).
 *
 * `email`, `endpointUrl`, `scopes`, the timestamps, and the error
 * fields are cleartext — they're either user-supplied identifiers
 * or operational metadata, not secrets.
 *
 * v1 envelope is the same one TOTP secrets use. M-later upgrades to
 * KMS-managed master + per-record DEK; the wire format `v1.<iv>.<tag>.<ct>`
 * is versioned so an upgrade is backward-compatible.
 *
 * Provider ids match the frontend's:
 *   "github" | "gitlab" | "jira" | "<future>"
 */

export const SUPPORTED_PROVIDER_IDS = [
  "github",
  "gitlab",
  "jira",
] as const;
export type ProviderId = (typeof SUPPORTED_PROVIDER_IDS)[number];

export interface Integration {
  _id: ObjectId;
  orgId: ObjectId;
  userId: ObjectId;
  providerId: string; // not narrowed to ProviderId — future providers ride along
  /** Display name shown in the UI ("GitHub Personal", "Self-hosted GitLab"). */
  label: string;
  /**
   * Envelope-encrypted access token. NULL when the provider doesn't
   * use one (Jira: just an apiToken, no accessToken).
   */
  encryptedToken: string | null;
  /** Envelope-encrypted API/PAT token (Jira pattern). */
  encryptedApiToken: string | null;
  /** Envelope-encrypted refresh token (OAuth providers). */
  refreshToken: string | null;
  /** Cleartext — the connected user's address on the provider. */
  email: string | null;
  /** Self-hosted GitLab / Jira instance base URL, when applicable. */
  endpointUrl: string | null;
  /** Granted scopes — provider-defined list of strings. */
  scopes: string[];
  connectedAt: Date;
  /** Token expiry, when known. Frontend uses this to nudge re-connect. */
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  lastErrorAt: Date | null;
  /** Last error message — short, for the "Reconnect" banner. */
  lastError: string | null;

  // ─ Cleartext identity metadata. NOT secrets — the connected user's
  //   handle / display name / avatar / team on the provider. Surfaced
  //   in the header chip and used by api-clients that need the username
  //   (gitlab reviewRequests, github events). Persisted so a fresh
  //   device / cleared-localStorage reconstructs identity from the
  //   server instead of re-deriving it via a proxy round-trip.
  //
  //   All optional/nullable for backward-compat with rows created
  //   before these fields shipped — readers (toPublic) default to null.
  /** Provider username / handle (e.g. GitHub login, GitLab username). */
  username?: string | null;
  /** Human-readable display name from the provider profile. */
  displayName?: string | null;
  /** Avatar image URL from the provider profile. */
  avatarUrl?: string | null;
  /** Team / squad label, when the user supplies one. */
  team?: string | null;
}

// ─── companion devices + pairings (Phase 3c) ─────────────────────────

/**
 * A registered companion-app device. Long-lived bearer tokens that
 * the companion sends as `Authorization: Bearer …` on its API calls.
 *
 * Token storage:
 *   The raw token is 32 random bytes encoded as base64url (~43 chars).
 *   We persist only its SHA-256 hash — a database-only compromise
 *   never yields a working token. On each verify, we hash the
 *   candidate the same way and look it up by `tokenHash` (indexed).
 *
 * Lifetime:
 *   Tokens DON'T expire by default. The user revokes them explicitly
 *   from the "Devices" UI (Phase 3e), or admins can mass-revoke if a
 *   laptop is lost. `revokedAt` flips non-null on revoke; the verify
 *   path treats those as not-found.
 *
 * `lastUsedAt` is bumped on every successful auth (throttled in the
 * verify helper) so the UI can show "this device last connected 3
 * minutes ago" without a separate heartbeat collection.
 */
export interface CompanionDevice {
  _id: ObjectId;
  userId: ObjectId;
  orgId: ObjectId;
  /** SHA-256 of the bearer token, base64url-encoded. */
  tokenHash: string;
  /** Human-readable label set during the pairing flow (e.g. "Maya's MacBook Pro"). */
  name: string;
  createdAt: Date;
  lastUsedAt: Date;
  /** When the user revoked the device. Null = active. */
  revokedAt: Date | null;
  createdByIp: string | null;
  createdByUa: string | null;
}

/**
 * In-flight device pairing. Created when the companion calls
 * /companion/pair/start; consumed (turned into a CompanionDevice) when
 * the user approves it from a logged-in browser tab.
 *
 * `_id` IS the pairing code the companion polls with — readable enough
 * for the user to verify on screen (e.g. "XKCD-1234"). Pairing codes
 * have a 5-minute TTL via the Mongo index on `expiresAt`; the
 * approval flow refuses pairings whose expiresAt has passed.
 */
export interface CompanionPairing {
  _id: string;
  /** Companion's self-reported device name. Stored separately so the
   * approval UI can show the user what they're approving. */
  deviceName: string;
  /** Source IP of the companion's /pair/start call — surfaced in the
   * approval UI so the user can spot a stranger trying to attach. */
  createdByIp: string | null;
  createdByUa: string | null;
  createdAt: Date;
  expiresAt: Date;
  /** Set when the user clicks Approve in the browser. */
  approvedAt: Date | null;
  /** The user who approved. Set together with approvedAt. */
  approvedByUserId: ObjectId | null;
  /** SHA-256 of the bearer token minted on approval. Returned to the
   * polling companion ONCE in plaintext on the polling call that
   * observes the approval, then forgotten — we keep only the hash on
   * the CompanionDevice row. */
  pendingTokenHash: string | null;
  /** Set when the polling companion has fetched its token. After
   * this, /pair/poll returns "consumed" and the row can be cleaned
   * up by the TTL index. */
  consumedAt: Date | null;
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

// ─── hub configs (M10.5) ─────────────────────────────────────────────

/**
 * Per-(orgId, hubId) override that merges on top of the shared
 * registry defaults in @espace-devhub/shared/hubs at resolution time.
 *
 * Every override field is OPTIONAL. Absent fields fall through to
 * the registry default. See modules/hubs/controller.ts for the merge
 * semantics (replace vs partial-replace per field).
 *
 * `null` on a scalar field means "no value" (passes through to the
 * default). `null` on a `pages.<slot>` ENTRY means "remove this slot
 * from the effective pages map".
 */
export interface HubConfig {
  _id: ObjectId;
  orgId: ObjectId;
  hubId: string;
  /** When false, the hub is filtered out of /hubs/me entirely. */
  enabled?: boolean | null;
  label?: string | null;
  description?: string | null;
  /** Replaces the registry default. Empty array is meaningful ("no
   *  integrations for this hub"). Null falls through. */
  allowedIntegrations?: string[] | null;
  /** Partial merge — only listed slot ids override. Null entries
   *  remove the slot from the effective map. */
  pages?: Record<string, string | null> | null;
  /** Replaces the registry default. */
  departments?: string[] | null;
  updatedBy: ObjectId | null;
  updatedAt: Date;
}

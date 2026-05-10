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

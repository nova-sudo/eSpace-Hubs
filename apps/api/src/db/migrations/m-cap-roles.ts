/**
 * M-CAP migration: populate `users.roles` from the legacy `role` field.
 *
 * Idempotent + safe to re-run. Touches only rows where `roles` is
 * missing/empty/null. The boot pipeline calls it after validators
 * but before the server starts accepting requests.
 *
 * Rules:
 *   - role === "member"  → roles = ["dev"] (engineers under the
 *                          generic pre-M-CAP role; the M-OB
 *                          department mapping makes new users
 *                          start with the right role going forward)
 *   - any other role     → roles = [role] (single-element)
 *
 * Admin auto-expansion was tried in the first cut of this migration
 * (admin → admin+dev+qa) to preserve the bootstrap admin's
 * pre-M-CAP multi-hub view. That was the wrong call: the design
 * intent is that admin is admin-only by default, and an admin who
 * also wants Dev/QA access gets it via an explicit `--roles=admin,dev`
 * at admin-create time, or via the admin UI later. The single-role
 * fallback is correct.
 *
 * Result is logged at info level with counts per outcome. Failure
 * is non-fatal: server boots regardless so /healthz stays green;
 * the migration retries on next boot.
 */

import type { Collection } from "mongodb";
import { logger } from "../../lib/logger.js";
import type { User, UserRole } from "../types.js";

interface MigrationResult {
  scanned: number;
  migrated: number;
  byOutcome: Record<string, number>;
}

export async function migrateUserRoles(
  users: Collection<User>,
): Promise<MigrationResult> {
  const cursor = users.find(
    {
      $or: [{ roles: { $exists: false } }, { roles: null }, { roles: { $size: 0 } }],
    },
    { projection: { _id: 1, role: 1, email: 1 } },
  );

  const result: MigrationResult = {
    scanned: 0,
    migrated: 0,
    byOutcome: {},
  };

  for await (const row of cursor) {
    result.scanned += 1;
    const legacyRole = row.role as UserRole;
    let roles: UserRole[];
    let outcome: string;
    if (legacyRole === "member") {
      // Legacy "member" was the generic engineer role; map to the
      // new explicit "dev" role.
      roles = ["dev"];
      outcome = "member→dev";
    } else {
      // Every other role (including admin) gets converted as-is to
      // a single-element array. Admin remains admin-only by default;
      // multi-hub admins are opted in via --roles at admin-create.
      roles = [legacyRole];
      outcome = `single:${legacyRole}`;
    }

    try {
      await users.updateOne(
        { _id: row._id },
        {
          $set: {
            roles,
            // Keep `role` synced to roles[0] — the compat shim reads
            // both, but having them aligned makes ad-hoc Mongo queries
            // less confusing.
            role: roles[0],
            updatedAt: new Date(),
          },
        },
      );
      result.migrated += 1;
      result.byOutcome[outcome] = (result.byOutcome[outcome] ?? 0) + 1;
    } catch (err) {
      logger.warn(
        {
          userId: row._id.toHexString(),
          email: row.email,
          err: err instanceof Error ? err.message : String(err),
        },
        "[migrate.m-cap] user migration failed; will retry on next boot",
      );
    }
  }

  return result;
}

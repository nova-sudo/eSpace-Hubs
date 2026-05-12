/**
 * Backfill `sessions.totpEnrolled` for rows minted before that field
 * existed.
 *
 * Why: the M-CAP follow-up that introduced server-side
 * `requireTotpEnrolled` keys off `session.totpEnrolled`. Sessions
 * minted before the field was added carry it as `undefined`. The
 * middleware treats `undefined` leniently (allows the request) for
 * backward-compat, but that defeats the gate for the rollover
 * window. This migration sets the flag explicitly based on the
 * owning user's `totpEnrolledAt` so the gate is correct from boot.
 *
 * Idempotent + safe to re-run. Touches only sessions missing the
 * field. Failure is non-fatal — server boots, retries next boot.
 */

import type { Collection } from "mongodb";
import type { Session, User } from "../types.js";
import { logger } from "../../lib/logger.js";

interface MigrationResult {
  scanned: number;
  updated: number;
  byOutcome: { enrolled: number; notEnrolled: number; userMissing: number };
}

export async function backfillSessionTotpEnrolled(
  sessions: Collection<Session>,
  users: Collection<User>,
): Promise<MigrationResult> {
  const result: MigrationResult = {
    scanned: 0,
    updated: 0,
    byOutcome: { enrolled: 0, notEnrolled: 0, userMissing: 0 },
  };

  // A field that "doesn't exist" matches `{ totpEnrolled: { $exists: false } }`.
  // We DO NOT match `null` here — that's a legitimate state the admin
  // TOTP-reset flow sets, and we don't want to overwrite it.
  const cursor = sessions.find({ totpEnrolled: { $exists: false } });

  for await (const session of cursor) {
    result.scanned++;
    const user = await users.findOne(
      { _id: session.userId },
      { projection: { totpEnrolledAt: 1 } },
    );

    if (!user) {
      // The session's user is gone — usually safe to leave the
      // session; the next lookup will fail and the row gets evicted.
      // We don't try to repair an orphan here.
      result.byOutcome.userMissing++;
      continue;
    }

    const enrolled = user.totpEnrolledAt !== null;
    await sessions.updateOne(
      { _id: session._id },
      { $set: { totpEnrolled: enrolled } },
    );
    result.updated++;
    if (enrolled) result.byOutcome.enrolled++;
    else result.byOutcome.notEnrolled++;
  }

  return result;
}

export async function runTotpEnrolledSessionsMigration(
  sessions: Collection<Session>,
  users: Collection<User>,
): Promise<void> {
  try {
    const r = await backfillSessionTotpEnrolled(sessions, users);
    if (r.scanned > 0) {
      logger.info(
        {
          scanned: r.scanned,
          updated: r.updated,
          byOutcome: r.byOutcome,
        },
        "[migrate.totp-enrolled-sessions] backfill complete",
      );
    } else {
      logger.debug("[migrate.totp-enrolled-sessions] no rows to migrate");
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[migrate.totp-enrolled-sessions] failed — retries on next boot",
    );
  }
}

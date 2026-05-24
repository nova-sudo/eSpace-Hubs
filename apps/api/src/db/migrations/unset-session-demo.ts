/**
 * One-shot: $unset the legacy `demo` field from every session row.
 *
 * Demo mode was removed in the demo-mode-removal cleanup. The
 * sessions.schema validator still lists `demo` in `properties`
 * (without `required[]`) so lingering rows pass validation on
 * update — but we'd rather have the field gone entirely so a
 * follow-up PR can drop the property declaration too.
 *
 * Strategy: bulk updateMany with `{ demo: { $exists: true } }`. Fast
 * (sessions are bounded by TTL — typically a few thousand rows max),
 * idempotent (re-runs after the first see nothing to do), non-fatal
 * on failure (logged + retried next boot).
 */

import type { Collection } from "mongodb";
import type { Session } from "../types.js";
import { logger } from "../../lib/logger.js";

export async function runUnsetSessionDemoMigration(
  sessions: Collection<Session>,
): Promise<void> {
  try {
    const result = await sessions.updateMany(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { demo: { $exists: true } } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { $unset: { demo: "" } } as any,
    );
    if (result.modifiedCount > 0) {
      logger.info(
        { modified: result.modifiedCount },
        "[migrate.unset-session-demo] stripped demo field from session rows",
      );
    } else {
      logger.debug("[migrate.unset-session-demo] no rows to migrate");
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[migrate.unset-session-demo] failed — retries on next boot",
    );
  }
}

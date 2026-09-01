/**
 * F4 — the API scheduler (#229). Closes the "everything is passive"
 * gap: dueAt was rendered in four places and compared to Date.now()
 * nowhere, no server-side clock existed, and notifications were only
 * ever written by request handlers.
 *
 * Design: a plain hourly tick, no cron dependency. Every job is
 * idempotent via the scheduler_stamps ledger (see jobs.ts), so tick
 * timing needs no precision — a job that "should" run Monday 07:00
 * runs on the first tick after that instant, and re-ticks are no-ops.
 *
 * Deployment contract:
 *   - Runs by default; set SCHEDULER_ENABLED=false to switch off.
 *   - The desktop companion spawns this same server with
 *     SCHEDULER_ENABLED=false (see apps/desktop backend-process.ts) —
 *     a laptop process must not double-notify against the cloud Mongo.
 *   - Single-instance assumption (Coolify runs one api container).
 *     Stamps make concurrent instances mostly-safe, but two racing
 *     processes can double-send an EMAIL only where a job acts before
 *     claiming — jobs never do; the claim always comes first.
 */

import { logger } from "../lib/logger.js";
import {
  captureWeeklySnapshots,
  notifyGoalDeadlines,
  notifyStaleGoals,
  notifyWaitingApprovals,
  sendWeeklyDigests,
} from "./jobs.js";

const FIRST_TICK_DELAY_MS = 30_000; // let Mongo bootstrap settle
const TICK_INTERVAL_MS = 3_600_000; // hourly

let started = false;
let ticking = false;

async function tick(): Promise<void> {
  if (ticking) return; // a slow tick must not overlap the next
  ticking = true;
  const now = new Date();
  const jobs: Array<[string, (n: Date) => Promise<void>]> = [
    ["deadlines", notifyGoalDeadlines],
    ["stale", notifyStaleGoals],
    ["approvals", notifyWaitingApprovals],
    ["digest", sendWeeklyDigests],
    // Snapshots BEFORE digest would be nicer (the digest could mention
    // them), but order here is freshness cosmetics — every job is
    // idempotent and the hourly tick closes any gap within the hour.
    ["snapshots", captureWeeklySnapshots],
  ];
  for (const [name, job] of jobs) {
    try {
      await job(now);
    } catch (err) {
      logger.warn(
        { job: name, err: err instanceof Error ? err.message : String(err) },
        "[scheduler] job failed — next tick retries",
      );
    }
  }
  ticking = false;
}

export function startScheduler(): void {
  if (started) return;
  if (process.env.SCHEDULER_ENABLED === "false") {
    logger.info("[scheduler] disabled via SCHEDULER_ENABLED=false");
    return;
  }
  started = true;
  logger.info(
    { firstTickInMs: FIRST_TICK_DELAY_MS, intervalMs: TICK_INTERVAL_MS },
    "[scheduler] started (hourly tick)",
  );
  // unref() — the scheduler must never hold an otherwise-drained
  // process open during graceful shutdown.
  setTimeout(() => void tick(), FIRST_TICK_DELAY_MS).unref();
  setInterval(() => void tick(), TICK_INTERVAL_MS).unref();
}

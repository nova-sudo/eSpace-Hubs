/**
 * Pure rules for the due-soon / overdue nudges (jobs.ts → notifyGoalDeadlines
 * and the weekly digest). Kept DB-free so they're unit-tested.
 *
 * review-ux-flows R14 / review-ui-polish M8: the bell nagged "Overdue: …
 * Log what happened" for goals the user can't log into — no tracker yet,
 * a delegated or manager-judged goal, a tracker waiting on approval — and
 * for recurring trackers whose "due date" is just the end of the cycle.
 * Those nudges are noise; the dates were raw ISO too.
 */

import { specCadence } from "@espace-devhub/shared/goal-specs";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Cadences whose windows recur — their due date is the cycle end, not a deliverable. */
const RECURRING = new Set(["daily", "weekly", "biweekly", "monthly", "quarterly", "continuous"]);

/** "2026-06-30" → "30 Jun" (same year as `now`) or "30 Jun 2025". Unparseable → input. */
export function formatDueDay(iso: string, now: Date = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return iso;
  const [, y, mo, d] = m;
  const month = MONTHS[Number(mo) - 1];
  if (!month) return iso;
  const day = `${Number(d)} ${month}`;
  return Number(y) === now.getUTCFullYear() ? day : `${day} ${y}`;
}

export type NudgeSkip =
  | "no_tracker"
  | "delegated"
  | "untrackable"
  | "awaiting_approval"
  | "recurring";

/**
 * Why this goal must NOT get a deadline nudge, or null when it should.
 * `overdue` only: a recurring tracker's cycle end isn't a missed deadline
 * (a due-soon nudge for it still helps — "fill the window before it closes").
 */
export function deadlineNudgeSkip(spec: unknown, overdue: boolean): NudgeSkip | null {
  if (!spec || typeof spec !== "object") return "no_tracker";
  const s = spec as {
    delegated?: { delegated?: boolean } | null;
    untrackable?: unknown;
    approval?: { status?: unknown } | null;
  };
  // Delegated goals are judged by someone else (manager, senior, peer).
  if (s.delegated?.delegated) return "delegated";
  if (s.untrackable) return "untrackable";
  // Pending / sent-back trackers are read-only until a decision lands.
  const status = s.approval?.status;
  if (status === "pending" || status === "rejected") return "awaiting_approval";
  if (overdue) {
    const cadence = specCadence(spec);
    if (cadence && RECURRING.has(cadence)) return "recurring";
  }
  return null;
}

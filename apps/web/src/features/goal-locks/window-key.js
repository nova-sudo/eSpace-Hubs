/**
 * The key identifying a goal's CURRENT cadence window — what a lock is
 * scoped to. "Lock this week" means "lock window `currentWindowKey(...)` for
 * this goal", and the status logic asks the same question to decide whether
 * the goal is still owed.
 *
 * Bucketing cadences use the SAME key the cadence stepper and the grader use
 * (`currentPeriodKey` from the shared window model), so a window settled from
 * the Intelligence hub shows as settled on the Goals page and vice versa:
 *
 *   daily / weekly / biweekly → "YYYY-D<n>" / "YYYY-W<n>" / "YYYY-B<n>"
 *                               (window index within the goal's cycle — for a
 *                               calendar-year weekly goal, n IS the Sunday
 *                               work-week number: "2026-W39" = Sep 20–26)
 *   monthly                   → "YYYY-MM"
 *   quarterly                 → "YYYY-Q#"
 *   milestone / continuous /
 *   per-incident              → "all"  (no recurring window — one lock
 *                               finalises it)
 *
 * Pass the goal's cycle bounds (`composedCycleBounds(spec)`) so a plan that
 * doesn't run Jan–Dec keys its own windows.
 *
 * Before windows were Sunday-anchored this module had its own scheme
 * ("YYYY-W##" zero-padded Sunday week, "YYYY-MM-DD" for daily). Locks written
 * under it are still honoured: `legacyCurrentWindowKey` names them for
 * `isCurrentWindowLocked`, and the shared window model reads them as aliases
 * (`windowKeyAliases`) for every past window.
 */

import { currentPeriodKey } from "@/features/goal-inputs";

const BUCKETING = new Set(["daily", "weekly", "biweekly", "monthly", "quarterly"]);

export function currentWindowKey(cadence, date = new Date(), bounds = {}) {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return "all";
  if (!BUCKETING.has(cadence)) {
    // milestone / continuous / per-incident / unknown — a single bucket,
    // so locking once finalises the goal until unlocked.
    return "all";
  }
  return (
    currentPeriodKey(cadence, d.getTime(), bounds?.cycleStart, bounds?.cycleEnd) ??
    legacyCurrentWindowKey(cadence, d) ??
    "all"
  );
}

/**
 * The key this module wrote for the current window before it shared the
 * cadence window model — read-only, so settles made then still count.
 * Null where the old scheme matches the new one (monthly / quarterly).
 */
export function legacyCurrentWindowKey(cadence, date = new Date()) {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return null;
  const y = d.getFullYear();
  switch (cadence) {
    case "daily":
      return `${y}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    case "weekly":
    case "biweekly":
      return `${y}-W${pad2(weekOfYear(d))}`;
    default:
      return null;
  }
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

const DAY_MS = 24 * 60 * 60 * 1000;

function weekOfYear(d) {
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const daysSince = Math.floor((d.getTime() - yearStart.getTime()) / DAY_MS);
  return Math.floor((daysSince + yearStart.getDay()) / 7) + 1;
}

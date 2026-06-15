/**
 * The key identifying a goal's CURRENT cadence window — what a lock is
 * scoped to. "Lock this week" means "lock window `currentWindowKey('weekly')`
 * for this goal", and the status logic asks the same question to decide
 * whether the goal is still owed.
 *
 * Keys are calendar-period based (stable within a period, advance when it
 * rolls over) and self-contained to this feature — they don't need to match
 * any other module's scheme, only to be consistent here.
 *
 *   daily              → "YYYY-MM-DD"
 *   weekly / biweekly  → "YYYY-W##"  (simple Sunday-anchored week-of-year)
 *   monthly            → "YYYY-MM"
 *   quarterly          → "YYYY-Q#"
 *   milestone /
 *   continuous /
 *   per-incident       → "all"  (no recurring window — one lock finalises it)
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function currentWindowKey(cadence, date = new Date()) {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return "all";
  const y = d.getFullYear();
  switch (cadence) {
    case "daily":
      return `${y}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    case "weekly":
    case "biweekly":
      return `${y}-W${pad2(weekOfYear(d))}`;
    case "monthly":
      return `${y}-${pad2(d.getMonth() + 1)}`;
    case "quarterly":
      return `${y}-Q${Math.floor(d.getMonth() / 3) + 1}`;
    default:
      // milestone / continuous / per-incident / unknown — a single bucket,
      // so locking once finalises the goal until unlocked.
      return "all";
  }
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function weekOfYear(d) {
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const daysSince = Math.floor((d.getTime() - yearStart.getTime()) / DAY_MS);
  return Math.floor((daysSince + yearStart.getDay()) / 7) + 1;
}

/**
 * Formatting helpers shared across the manager portal. Pure — the logic
 * layer for the hub's date and ratio copy, so no page re-implements
 * "6 days ago" slightly differently.
 */

/** Relative age of an ISO timestamp — "today", "3d ago", "2mo ago". */
export function ago(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * How long something has been waiting, as a duration rather than a
 * point in time — "2 days", "5 weeks". Accepts an ISO string or an
 * epoch-ms number (the approvals queue sends the latter).
 */
export function waitedFor(value) {
  const t = typeof value === "number" ? value : Date.parse(value ?? "");
  if (!t || Number.isNaN(t)) return null;
  const days = Math.max(0, Math.floor((Date.now() - t) / 86400000));
  if (days === 0) return "today";
  if (days === 1) return "1 day";
  if (days < 21) return `${days} days`;
  const weeks = Math.floor(days / 7);
  if (weeks < 9) return `${weeks} weeks`;
  return `${Math.floor(days / 30)} months`;
}

/** Age in whole days, for sorting an "oldest first" queue. */
export function daysWaiting(value) {
  const t = typeof value === "number" ? value : Date.parse(value ?? "");
  if (!t || Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

/** A calendar date, spelled out — "2 Sep 2026". */
export function onDate(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Whole-number percentage, 0 when there's nothing to divide by. */
export function percent(n, total) {
  return total ? Math.round((n / total) * 100) : 0;
}

/** "person" / "people", "goal" / "goals" — the two the hub keeps needing. */
export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

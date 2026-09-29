/**
 * Formatting helpers shared across the manager portal. Pure — the logic
 * layer for the hub's date and ratio copy, so no page re-implements
 * "6 days ago" slightly differently.
 */

import { STATUS_META, periodWords, statusMeta } from "@/features/goal-inputs";

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

/** A short calendar date — "3 Sep". */
export function shortDate(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * One goal's grade history as readable sentences, one per grading
 * period, newest period first:
 *
 *   { periodKey: "2026",
 *     text: "Over achieved by Ana on 3 Sep, changed to Achieved on 20 Sep" }
 *
 * `history` is the oldest-first list from
 * GET /manager/reports/:userId/goals/:goalId/verdicts; `labels` maps a
 * tier key to its display label. A grader is named again only when a
 * different person made the change.
 */
export function describeVerdictHistory(history, labels) {
  const byPeriod = new Map();
  for (const h of history ?? []) {
    if (!byPeriod.has(h.periodKey)) byPeriod.set(h.periodKey, []);
    byPeriod.get(h.periodKey).push(h);
  }
  const out = [];
  for (const [periodKey, rows] of byPeriod) {
    let prevBy = null;
    const parts = rows.map((h, i) => {
      const label = labels?.[h.tier] ?? h.tier;
      const when = shortDate(h.gradedAt);
      const by = h.gradedByName && h.gradedByName !== prevBy ? ` by ${h.gradedByName}` : "";
      prevBy = h.gradedByName || prevBy;
      const on = when ? ` on ${when}` : "";
      if (i === 0) return `${label}${by}${on}`;
      return h.previousTier === h.tier
        ? `re-confirmed${by}${on}`
        : `changed to ${label}${by}${on}`;
    });
    out.push({ periodKey, text: parts.join(", ") });
  }
  return out.reverse();
}

/**
 * The report's acknowledgement of a grade as one line, or null when they
 * haven't looked yet: "Ana saw this on 21 Sep" / "Ana disagrees (21 Sep)".
 */
export function describeAck(ack, firstName = "They") {
  if (!ack) return null;
  const when = shortDate(ack.at);
  if (ack.disagree) return `${firstName} disagrees${when ? ` (${when})` : ""}`;
  return `${firstName} saw this${when ? ` on ${when}` : ""}`;
}

/**
 * The goal's status in the SAME words the report sees on their own Home,
 * Goals and Evidence pages — the API derives it with the shared status model
 * (`goalStatus`), and the label/tint come from the one `STATUS_META`.
 */
export function goalStatusMeta(goal) {
  const meta = STATUS_META[goal?.status] ?? statusMeta(goal?.status);
  return {
    label: goal?.statusLabel ?? meta.label,
    tone: goal?.statusTone ?? meta.tone,
    reason: goal?.statusReason ?? null,
  };
}

/** "Behind · 1 week missed · 4 of 6 weeks logged" — the row's sub-line. */
export function statusLine(goal) {
  const m = goalStatusMeta(goal);
  const logged = goal?.logged;
  const cadenceWord = periodWords(goal?.cadence)[1];
  return [
    m.label,
    m.reason,
    logged && logged.due > 0 ? `${logged.done} of ${logged.due} ${cadenceWord} logged` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

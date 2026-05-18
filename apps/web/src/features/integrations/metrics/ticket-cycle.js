/**
 * Jira ticket cycle-time metrics.
 *
 * "Cycle time" here is the simple `resolutiondate - created` duration —
 * MVP definition that doesn't need per-ticket changelog reads. A truer
 * "in-progress → done" cycle time requires the Jira `expand=changelog`
 * payload (status-transition timestamps); when we wire that we'll add a
 * second pair of helpers here and let widgets opt in via spec.source.
 *
 * Pure functions — no React, no SWR. Takes the raw Jira issue array
 * shape (objects with `fields.created`, `fields.resolutiondate`,
 * `fields.status.name`).
 */

import { DAY_MS } from "@/lib/date";

/**
 * Keep only tickets that have BOTH `fields.created` and a non-null
 * `fields.resolutiondate`. Optionally filter to tickets resolved on/after
 * `sinceIso` so the window matches the rest of the AUTO metrics.
 *
 * `sinceIso` is the ISO string returned by `isoDaysAgo(days)` (snapped to
 * UTC midnight). Passing `null` returns every resolved ticket.
 */
export function resolvedTicketsInWindow(tickets = [], sinceIso = null) {
  const sinceMs = sinceIso ? new Date(sinceIso).getTime() : -Infinity;
  return tickets.filter((t) => {
    const resolved = t?.fields?.resolutiondate;
    const created = t?.fields?.created;
    if (!resolved || !created) return false;
    return new Date(resolved).getTime() >= sinceMs;
  });
}

/** Median cycle time (resolutiondate − created), in days. */
export function medianTicketCycleDays(tickets = []) {
  const durations = tickets
    .filter((t) => t?.fields?.resolutiondate && t?.fields?.created)
    .map(
      (t) =>
        (new Date(t.fields.resolutiondate) - new Date(t.fields.created)) /
        DAY_MS,
    )
    .sort((a, b) => a - b);
  if (durations.length === 0) return null;
  const mid = Math.floor(durations.length / 2);
  return durations.length % 2
    ? durations[mid]
    : (durations[mid - 1] + durations[mid]) / 2;
}

/**
 * Bucketize cycle time into 6 display bins. Bins are wider than the PR
 * turnaround histogram because Jira tickets typically live in days/weeks
 * (a "<2h" bin is wasted real estate for ticket data).
 */
const BINS = [
  { label: "<1d", max: 1 },
  { label: "1–3d", max: 3 },
  { label: "3–7d", max: 7 },
  { label: "1–2w", max: 14 },
  { label: "2–4w", max: 28 },
  { label: ">4w", max: Infinity },
];

export function ticketCycleHistogram(tickets = []) {
  const bins = BINS.map((b) => ({ ...b, n: 0 }));
  for (const t of tickets) {
    const resolved = t?.fields?.resolutiondate;
    const created = t?.fields?.created;
    if (!resolved || !created) continue;
    const days = (new Date(resolved) - new Date(created)) / DAY_MS;
    const bucket = bins.find((b) => days < b.max);
    if (bucket) bucket.n += 1;
  }
  return bins;
}

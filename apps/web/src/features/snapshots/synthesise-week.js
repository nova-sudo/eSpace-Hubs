"use client";

/**
 * `synthesiseWeek` — capture (or re-capture) the snapshot for ONE
 * specific Sun → Thu work-week.
 *
 * Lifted out of `use-backfill.js` so it can be called from two places:
 *
 *   1. The backfill hook (`useBackfill`) walks every missing completed
 *      week since Jan 1 and writes one snapshot per week.
 *   2. The weekly check-in page (`/[hub]/checkin`) re-runs it for the
 *      currently-active week whenever the user saves manual inputs —
 *      so the snapshot stream stays in sync with what the form just
 *      wrote into the goal-inputs store.
 *
 * The function is pure aside from the `saveSnapshot` side-effect. It
 * reads the existing snapshot stream once to thread prior-week
 * `cumulative` values through the monthly/quarterly cadence-windows,
 * so the running totals chain correctly even when weeks are filled
 * out of order.
 *
 * Inputs (one object):
 *   range       — { start, end, weekLabel } — same triple used by the
 *                 auto-snapshotter + backfill enumerator. `weekLabel`
 *                 is the "Wnn" string the snapshot store keys on.
 *   goals       — { l1s: [...] } from useGoals(); used to walk every
 *                 classified L2 (the captureGoalReadings call below).
 *   specs       — Map<goalId, spec> from useGoalSpecs().
 *   mrs         — array of merged PRs visible to the caller. Will be
 *                 filtered to this week's window inside.
 *   events      — array of event-feed entries (90d horizon). Older
 *                 weeks get partial:true + gaps:["events"].
 *   tickets     — Jira issues array (or empty).
 *   allInputs   — full {goalId → entries[]} map from readInputs(); the
 *                 capture step slices it per goal.
 *
 * Returns the snapshot object that was written (post-normalisation by
 * saveSnapshot). Callers that don't care can ignore it.
 *
 * The `saveSnapshot` helper enforces "manual wins over auto" — if a
 * user manually edited the headline metrics for this week and we then
 * re-run synthesise from check-in, the manual values stay. Goal
 * readings get refreshed unconditionally since they're the whole point
 * of the re-capture.
 */

import {
  avgReviewerComments,
  countMrComments,
  linkagePct,
  medianTurnaroundDays,
} from "@/features/integrations";
import { captureGoalReadings } from "./capture-readings";
import { readSnapshots, saveSnapshot } from "./snapshots-store";

const DAY = 24 * 60 * 60 * 1000;
const EVENTS_HORIZON_DAYS = 90;

/**
 * @param {{
 *   range:     { start: Date, end: Date, weekLabel: string },
 *   goals:     { l1s: Array<any> },
 *   specs:     Map<string, any> | Record<string, any>,
 *   mrs:       Array<any>,
 *   events:    Array<any>,
 *   tickets:   Array<any>,
 *   allInputs: Record<string, Array<any>>,
 *   capturedBy?: "auto" | "manual", // defaults to "auto"
 * }} args
 */
export function synthesiseWeek({
  range,
  goals,
  specs,
  mrs,
  events,
  tickets,
  allInputs,
  capturedBy = "auto",
  note,
}) {
  const startMs = range.start.getTime();
  const endMs = range.end.getTime();

  const mrsThisWeek = (mrs || []).filter((m) => {
    if (!m.merged_at) return false;
    const t = new Date(m.merged_at).getTime();
    return t >= startMs && t < endMs;
  });
  const eventsThisWeek = (events || []).filter((e) => {
    const t = new Date(e.created_at || 0).getTime();
    return t >= startMs && t < endMs;
  });

  // Was the events feed available for this week? GitHub caps at ~90d.
  // For weeks older than that, mark partial + gaps so the snapshot
  // honestly says "events unavailable".
  const ageDays = Math.floor((Date.now() - endMs) / DAY);
  const eventsAvailable = ageDays <= EVENTS_HORIZON_DAYS;
  const partial = !eventsAvailable;
  const gaps = eventsAvailable ? [] : ["events"];

  const merged = mrsThisWeek.length;
  const reviews = eventsAvailable ? countMrComments(eventsThisWeek) : 0;
  const median = medianTurnaroundDays(mrsThisWeek);
  const linkage = linkagePct(mrsThisWeek)?.pct ?? 0;
  const rounds = avgReviewerComments(mrsThisWeek) ?? 0;

  // priorReadings: pick up the most recent snapshot already in the
  // store whose week sits BEFORE this one so monthly/quarterly
  // cumulatives chain through correctly. Sorting by weekLabel is fine
  // within a year — "W17" < "W18" lexicographically.
  const existing = readSnapshots();
  const prior = existing
    .filter((s) => s.week && s.week < range.weekLabel)
    .sort((a, b) => b.week.localeCompare(a.week))[0] || null;
  // synthesise is the ONLY writer of the headline metrics + goalReadings,
  // so recomputing them is always safe. The `note`, however, is hand-typed
  // by the user and must survive a re-capture (backfill refresh or a
  // check-in re-save). Preserve the stored note unless the caller passes
  // an explicit one.
  const currentWeekSnap =
    existing.find((s) => s.week === range.weekLabel) || null;

  const goalReadings = captureGoalReadings({
    weekStart: range.start,
    weekEnd: range.end,
    goals,
    specs,
    mrs: mrsThisWeek,
    events: eventsThisWeek,
    tickets: tickets || [],
    allInputs: allInputs || {},
    priorReadings: prior?.goalReadings || null,
  });

  return saveSnapshot({
    week: range.weekLabel,
    capturedAt: new Date(endMs).toISOString(),
    capturedBy,
    merged,
    reviews,
    turnaround: median == null ? 0 : Math.round(median * 24),
    linkage,
    rounds: Math.round(rounds * 10) / 10,
    note: note ?? currentWeekSnap?.note ?? "",
    goalReadings,
    partial,
    gaps,
  });
}

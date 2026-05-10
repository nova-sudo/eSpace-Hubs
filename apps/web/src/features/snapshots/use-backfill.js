"use client";

/**
 * Backfill — synthesise weekly snapshots for the past N completed
 * Sun → Thu work-weeks that don't have a snapshot yet, using whatever
 * integration data is already loaded.
 *
 * Two onboarding paths this addresses:
 *
 *   - **Case 1 (mid-year join):** user installs in April. `useAutoSnapshot`
 *     would only capture the most recent completed week going forward,
 *     so weeks 1-15 of the year stay empty in the snapshot store.
 *     Without backfill, compliance reads "1 of 1 closed week" forever.
 *
 *   - **Case 2 (full-year onboard):** user is on the app from week 1.
 *     `useAutoSnapshot` captures organically each week. Backfill is a
 *     no-op because every week already has a snapshot.
 *
 * What this implementation does
 * ─────────────────────────────
 * Walks every completed Sun → Thu week between Jan 1 of the current
 * year and "now". For each missing week, it slices the loaded merged-PR
 * + event data to that week's window and synthesises a snapshot using
 * `captureGoalReadings`.
 *
 * Limitations (acknowledged honestly):
 *   - The events feed only goes back ~90 days regardless of how far we
 *     try to scan. Older weeks get `partial: true` + `gaps: ["events"]`.
 *     Heatmap/reviews-given numbers from those weeks are 0 — flagged as
 *     unavailable, not as "you did zero".
 *   - The merged-PR list is fetched from `created:>=Jan-1` (no cap), so
 *     PR-derived metrics CAN reach back to Jan 1 reliably.
 *
 * Returns a `{ run, isRunning, progress }` triple. The banner consumes
 * `progress` for "synthesising week 8 of 17" and `run()` is the
 * trigger button. The hook itself doesn't auto-run — the banner
 * component decides whether to surface it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  readSnapshots,
  saveSnapshot,
} from "./snapshots-store";
import { captureGoalReadings } from "./capture-readings";
import { useGoals } from "@/features/goals";
import { useGoalSpecs } from "@/features/goal-specs";
import {
  avgReviewerComments,
  countMrComments,
  linkagePct,
  medianTurnaroundDays,
  useCombinedEventsSince,
  useCombinedMergedSince,
  useJiraTickets,
} from "@/features/integrations";
import { readInputs } from "@/features/goal-inputs";
import { isoDaysAgo, weekLabel } from "@/lib/date";

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const EVENTS_HORIZON_DAYS = 90;

/**
 * @returns {{
 *   run:        () => Promise<void>,
 *   isRunning:  boolean,
 *   progress:   { done: number, total: number } | null,
 *   missingWeeks: number,   // count of completed weeks missing a snapshot
 * }}
 */
export function useBackfill() {
  const { goals } = useGoals();
  const { specs } = useGoalSpecs();
  const { data: mrs } = useCombinedMergedSince(isoDaysAgo(365));
  const { data: events } = useCombinedEventsSince(isoDaysAgo(EVENTS_HORIZON_DAYS));
  const { data: jira } = useJiraTickets();
  const allInputs = useMemo(() => readInputs(), []);

  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const cancelledRef = useRef(false);

  // Identify completed Sun → Thu weeks since Jan 1 that don't have a
  // snapshot yet. Used by the banner to show "X weeks need backfill".
  const missingWeeks = useMemo(() => {
    if (typeof window === "undefined") return 0;
    const ranges = enumerateCompletedWeeks();
    const existing = new Set(readSnapshots().map((s) => s.week));
    return ranges.filter((r) => !existing.has(r.weekLabel)).length;
  }, [isRunning]); // re-evaluate after a run

  const run = useCallback(async () => {
    if (isRunning) return;
    if (typeof window === "undefined") return;
    cancelledRef.current = false;
    setIsRunning(true);

    const ranges = enumerateCompletedWeeks();
    const existing = new Set(readSnapshots().map((s) => s.week));
    const missing = ranges.filter((r) => !existing.has(r.weekLabel));

    setProgress({ done: 0, total: missing.length });

    for (let i = 0; i < missing.length; i++) {
      if (cancelledRef.current) break;
      const range = missing[i];
      synthesiseWeek({
        range,
        goals,
        specs,
        mrs: mrs || [],
        events: events || [],
        tickets: Array.isArray(jira?.issues) ? jira.issues : [],
        allInputs,
      });
      setProgress({ done: i + 1, total: missing.length });
      // Yield to the browser so the banner re-renders.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 0));
    }

    setIsRunning(false);
    setProgress(null);
    if (missing.length > 0 && !cancelledRef.current) {
      toast.success(
        `Backfilled ${missing.length} week${missing.length === 1 ? "" : "s"} of history`,
      );
    }
  }, [goals, specs, mrs, events, jira, allInputs, isRunning]);

  useEffect(
    () => () => {
      cancelledRef.current = true;
    },
    [],
  );

  return { run, isRunning, progress, missingWeeks };
}

/* ─────────────── helpers ─────────────── */

/**
 * Every completed Sun → Thu week from Jan 1 of the current year up to
 * (but not including) the in-progress week. Returns each as
 * `{ start, end, weekLabel }` matching `useAutoSnapshot`'s shape.
 */
function enumerateCompletedWeeks() {
  const out = [];
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);

  // Walk backwards from "this Sunday" — find the Sunday of THIS week,
  // then iterate Sundays backwards to Jan 1.
  const thisSunday = new Date(now);
  thisSunday.setDate(now.getDate() - now.getDay());
  thisSunday.setHours(0, 0, 0, 0);

  let cursorSunday = new Date(thisSunday);
  // Skip the in-progress week — we only backfill COMPLETED ones. The
  // current week's Sunday hasn't yet seen its Thursday EOD.
  // To skip: jump back one week.
  cursorSunday.setDate(cursorSunday.getDate() - 7);

  while (cursorSunday >= yearStart) {
    const start = new Date(cursorSunday);
    const end = new Date(start);
    end.setDate(start.getDate() + 5); // Sun + 5 = Friday 00:00 (= Thu EOD)
    out.unshift({
      start,
      end,
      weekLabel: weekLabel(new Date(start.getTime() + 3 * DAY)),
    });
    cursorSunday.setDate(cursorSunday.getDate() - 7);
  }
  return out;
}

/**
 * Synthesise one week's snapshot from the loaded data. Filters merges
 * + events + inputs to the week's window, computes the headline
 * metrics, and runs `captureGoalReadings` for the per-goal map.
 */
function synthesiseWeek({
  range,
  goals,
  specs,
  mrs,
  events,
  tickets,
  allInputs,
}) {
  const startMs = range.start.getTime();
  const endMs = range.end.getTime();

  const mrsThisWeek = mrs.filter((m) => {
    if (!m.merged_at) return false;
    const t = new Date(m.merged_at).getTime();
    return t >= startMs && t < endMs;
  });
  const eventsThisWeek = events.filter((e) => {
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
  // store so monthly/quarterly cumulatives chain through correctly.
  const existing = readSnapshots();
  const prior = existing.find((s) => s.week < range.weekLabel);

  const goalReadings = captureGoalReadings({
    weekStart: range.start,
    weekEnd: range.end,
    goals,
    specs,
    mrs: mrsThisWeek,
    events: eventsThisWeek,
    tickets,
    allInputs,
    priorReadings: prior?.goalReadings || null,
  });

  saveSnapshot({
    week: range.weekLabel,
    capturedAt: new Date(endMs).toISOString(),
    capturedBy: "auto",
    merged,
    reviews,
    turnaround: median == null ? 0 : Math.round(median * 24),
    linkage,
    rounds: Math.round(rounds * 10) / 10,
    note: "",
    goalReadings,
    partial,
    gaps,
  });
}

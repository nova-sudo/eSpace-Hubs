"use client";

/**
 * Auto-snapshotter — runs on dashboard load, captures one snapshot per
 * completed Sun → Thu work-week.
 *
 * When does it fire?
 * ──────────────────
 * The team's work-week is Sun → Thu, so a "completed" week ends at
 * Thursday EOD (Friday 00:00 local). The snapshotter looks for the
 * most recent completed week and:
 *
 *   - if a snapshot for that week exists already → no-op
 *   - else → captures one with `capturedBy: "auto"`
 *
 * Self-healing: if the user opens the dashboard the following Tuesday
 * after being offline all weekend, the snapshotter still captures the
 * preceding week. Manual snapshots from the user are never overwritten
 * (`saveSnapshot` enforces that — incoming auto won't replace existing
 * manual).
 *
 * Why a hook (not a setInterval / service worker)?
 * ────────────────────────────────────────────────
 * No backend, no service worker. localStorage-only means "the
 * dashboard fires on visit" is the right cadence — same UX as an
 * email client polling on focus. Side effect: a user who never visits
 * the dashboard never gets snapshots; that's fine for this product
 * because reviews need engagement anyway.
 */

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  getSnapshotsState,
  readSnapshots,
  saveSnapshot,
} from "./snapshots-store";
import { useSnapshots } from "./use-snapshots";
import { captureGoalReadings } from "./capture-readings";
import { useGoals } from "@/features/goals";
import { useGoalSpecs, getSpecsState } from "@/features/goal-specs";
import {
  avgReviewerComments,
  countMrComments,
  linkagePct,
  medianTurnaroundDays,
  mergedThisWeek,
} from "@/features/integrations";
import {
  readInputs,
  useAllGoalInputs,
  getInputsState,
} from "@/features/goal-inputs";
import { readGoalLiveReading } from "@/features/goal-tiers";
import { isoDaysAgo, resolveCompletedWorkWeek } from "@/lib/date";
import { useDeferredFeeds } from "./use-deferred-feeds";
import { autoSnapshotNeeded, specsNeedJiraTickets } from "./snapshot-gates";

/**
 * Find the snapshot for the immediately PRIOR week — used to thread
 * cumulative numbers through cadence-windows that span multiple weeks.
 */
function priorWeekReadings(snapshots, currentWeekLabel) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return null;
  // Snapshots are kept newest-first (store sorts by year, then week).
  // We want the most recent that's NOT the current week.
  for (const s of snapshots) {
    if (s.week === currentWeekLabel) continue;
    return s.goalReadings || null;
  }
  return null;
}

/**
 * Fire-and-forget hook — mount it on the dashboard root. No return
 * value; side effects only (writes a snapshot when one is missing).
 */
export function useAutoSnapshot() {
  // Mount useSnapshots so this hook participates in the
  // hydration lifecycle — its effect kicks off the GET on
  // session establishment, and the hydration-state check
  // inside our own effect below waits for `fetched: true`
  // before deciding whether to capture. Without this, a
  // fresh-session auto-capture would race the hydration and
  // fire a wasted POST (the server's manual-wins dedupes it,
  // but it's noise). The `snapshots` array is used as an
  // effect dep so this hook re-evaluates once hydration lands.
  const { snapshots: snapshotsTick } = useSnapshots();
  const { allGoals: goals } = useGoals(); // incl. shared goals
  const { specs } = useGoalSpecs();
  // Subscribe to the inputs store so this hook re-evaluates once that
  // store hydrates — the capture reads readInputs() and would otherwise
  // snapshot empty manual-input readings on a fresh session.
  const inputsTick = useAllGoalInputs();
  // Provider feeds are ARMED only when a capture is actually due: the
  // store has hydrated (server truth) and last week has no snapshot. Until
  // then nothing is fetched — this runner is mounted on every dev page.
  const { fetched: snapshotsFetched } = getSnapshotsState();
  const dueWeek = resolveCompletedWorkWeek();
  const needed = autoSnapshotNeeded({
    fetched: snapshotsFetched,
    snapshots: readSnapshots(),
    weekLabel: dueWeek.weekLabel,
  });
  const { mrs, events, jira } = useDeferredFeeds({
    armed: needed,
    mergedSince: isoDaysAgo(120),
    eventsSince: isoDaysAgo(90),
    needJira: specsNeedJiraTickets(specs),
  });

  // Run-once-per-mount guard: the effect fires on first load and on
  // every re-render of the goals/specs/integration data. We only want
  // ONE capture attempt per page-load — re-fires can race on the
  // localStorage write event and wedge the toast.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    if (typeof window === "undefined") return;

    // Wait for the integration data to be at least partially loaded
    // before snapshotting — otherwise the first-paint snapshot would
    // capture all-zero metrics. The user would still see a snapshot
    // appear later when data lands, but the "initial empty" snapshot
    // would shadow it (already-exists check).
    if (!mrs || !events) return;

    // Wait for hydration of the snapshot store before deciding. The
    // useSnapshots() call above triggers the GET on session
    // establishment; we sit out until it lands. Without this gate the
    // first render after sign-in would see an empty `existing` and
    // fire a duplicate auto-capture which the server dedupes via
    // manual-wins — correct outcome, wasted POST.
    if (!getSnapshotsState().fetched) return;

    // Likewise wait for the specs + inputs stores (now API-direct) to
    // hydrate. captureGoalReadings reads `specs` and readInputs(); if
    // either is still empty we'd snapshot all-zero goal readings and the
    // run-once guard would never let the correct capture replace it.
    if (!getSpecsState().fetched) return;
    if (!getInputsState().fetched) return;

    const week = resolveCompletedWorkWeek();
    const existing = readSnapshots();
    const already = existing.find((s) => s.week === week.weekLabel);
    if (already) {
      ranRef.current = true;
      return;
    }

    const mergedThisW = mergedThisWeek(mrs).count;
    const reviews = countMrComments(events);
    const median = medianTurnaroundDays(mrs);
    const linkage = linkagePct(mrs)?.pct ?? 0;
    const rounds = avgReviewerComments(mrs) ?? 0;

    const goalReadings = captureGoalReadings({
      weekStart: week.start,
      weekEnd: week.end,
      goals,
      specs,
      mrs: mrs || [],
      events: events || [],
      tickets: Array.isArray(jira?.issues) ? jira.issues : [],
      allInputs: readInputs(),
      priorReadings: priorWeekReadings(existing, week.weekLabel),
      // Current-week capture only: freeze CI/CD + SCORECARD widgets'
      // last-published live values. Backfills (synthesise-week) omit
      // this on purpose — a past week must not carry today's numbers.
      readLive: readGoalLiveReading,
    });

    ranRef.current = true;
    void saveSnapshot({
      week: week.weekLabel,
      capturedAt: new Date().toISOString(),
      capturedBy: "auto",
      merged: mergedThisW,
      reviews,
      turnaround: median == null ? 0 : Math.round(median * 24),
      linkage,
      rounds: Math.round(rounds * 10) / 10,
      // Auto-captures don't add notes — if a manual snapshot exists for
      // this week the server keeps it (manual wins) and only fills in
      // goalReadings it lacked.
      note: "",
      goalReadings,
      partial: false,
      gaps: [],
    }).then((r) => {
      // Friendly confirmation — keeps the system feeling alive without
      // being noisy. Only fires on an actual, applied capture.
      if (r?.ok && r.precedence !== "manual_kept") {
        toast.success(`Captured weekly snapshot — ${week.weekLabel}`);
      }
    });
  }, [goals, specs, mrs, events, jira, snapshotsTick, inputsTick]);
}

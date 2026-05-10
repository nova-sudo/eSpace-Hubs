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
import { saveSnapshot } from "./snapshots-store";
import { readSnapshots } from "./snapshots-store";
import { captureGoalReadings } from "./capture-readings";
import { useGoals } from "@/features/goals";
import { useGoalSpecs } from "@/features/goal-specs";
import {
  avgReviewerComments,
  countMrComments,
  linkagePct,
  medianTurnaroundDays,
  mergedThisWeek,
  useCombinedEventsSince,
  useCombinedMergedSince,
  useJiraTickets,
} from "@/features/integrations";
import { readInputs } from "@/features/goal-inputs";
import { isoDaysAgo, weekLabel, DAY_MS } from "@/lib/date";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Resolve the most recent completed Sun → Thu work-week.
 *
 * Returns a `{ start, end, weekLabel }` triple where:
 *   start = the Sunday at 00:00 (start of the week)
 *   end   = the next Friday at 00:00 (Thursday EOD + 1ms is in Friday)
 *   weekLabel = "Wnn" (already-completed week)
 *
 * If "now" is INSIDE a Sun-Thu window (e.g. Wednesday), the function
 * returns the PRIOR week — we only snapshot completed weeks.
 */
function resolveCompletedWorkWeek(now = new Date()) {
  const d = new Date(now);
  // Day numbers: 0 = Sun, 1 = Mon, ..., 4 = Thu, 5 = Fri, 6 = Sat.
  const day = d.getDay();

  // Anchor: most recent Friday 00:00 (the moment the work-week ended).
  // - If today is Friday or later (Fri/Sat), the just-passed Friday is THIS week's
  //   end (5d ago Sun). Use that.
  // - If today is Sun..Thu, the most recent Friday is in the prior week.
  let daysSinceFriday;
  if (day >= 5) {
    daysSinceFriday = day - 5; // Fri=0, Sat=1
  } else {
    daysSinceFriday = day + 2; // Sun=2, Mon=3, ..., Thu=6
  }

  const friday = new Date(d);
  friday.setDate(d.getDate() - daysSinceFriday);
  friday.setHours(0, 0, 0, 0);

  const sunday = new Date(friday);
  sunday.setDate(friday.getDate() - 5); // Friday is 5 days after Sunday

  return {
    start: sunday,
    end: friday, // exclusive — week is [Sun 00:00, Fri 00:00)
    weekLabel: weekLabel(new Date(sunday.getTime() + 3 * DAY)), // mid-week date
  };
}

/**
 * Find the snapshot for the immediately PRIOR week — used to thread
 * cumulative numbers through cadence-windows that span multiple weeks.
 */
function priorWeekReadings(snapshots, currentWeekLabel) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return null;
  // Snapshots are kept newest-first; the week label sorts naturally
  // ("W17-2026" > "W16-2026"). We want the most recent that's NOT
  // the current week.
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
  const { goals } = useGoals();
  const { specs } = useGoalSpecs();
  const { data: mrs } = useCombinedMergedSince(isoDaysAgo(120));
  const { data: events } = useCombinedEventsSince(isoDaysAgo(90));
  const { data: jira } = useJiraTickets();

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
    });

    saveSnapshot({
      week: week.weekLabel,
      capturedAt: new Date().toISOString(),
      capturedBy: "auto",
      merged: mergedThisW,
      reviews,
      turnaround: median == null ? 0 : Math.round(median * 24),
      linkage,
      rounds: Math.round(rounds * 10) / 10,
      // Auto-captures don't add notes — but if a manual snapshot
      // existed for this week with a note, `saveSnapshot` refuses to
      // overwrite it (manual wins).
      note: "",
      goalReadings,
      partial: false,
      gaps: [],
    });

    ranRef.current = true;
    // Friendly confirmation — keeps the system feeling alive without
    // being noisy. Only fires on the actual capture.
    toast.success(`Captured weekly snapshot — ${week.weekLabel}`);
  }, [goals, specs, mrs, events, jira]);
}

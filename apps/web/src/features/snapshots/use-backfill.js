"use client";

/**
 * Backfill — (re)synthesise weekly snapshots for EVERY completed
 * Sun → Thu work-week of the current year, using whatever integration
 * data is already loaded.
 *
 * Two paths this addresses:
 *
 *   - **Case 1 (mid-year join):** user installs in April. `useAutoSnapshot`
 *     would only capture the most recent completed week going forward,
 *     so weeks 1-15 of the year stay empty in the snapshot store.
 *     Backfill creates the missing ones.
 *
 *   - **Case 2 (stale data refresh):** a week was captured while a
 *     provider was unreachable, or before an integration fix landed
 *     (e.g. the un-paginated merged-PR fetch that made every older week
 *     read 0 merged). Those weeks already HAVE a snapshot, so a "fill
 *     only the missing weeks" backfill would skip them forever. We
 *     instead recompute every completed week and overwrite the stored
 *     numbers in place.
 *
 * What this implementation does
 * ─────────────────────────────
 * Walks every completed Sun → Thu week between Jan 1 of the current
 * year and "now". For EACH week, it slices the loaded merged-PR + event
 * data to that week's window and synthesises a fresh snapshot using
 * `captureGoalReadings`. Each write preserves the week's existing
 * `capturedBy` so it lands through matching server precedence
 * (auto-over-auto / manual-over-manual) — an `auto` write can't clobber
 * a `manual` week, which is exactly why a plain "fill missing" backfill
 * left stale manual zeros stuck. The hand-typed `note` is preserved by
 * `synthesiseWeek`; only machine-derived fields are recomputed.
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
 *
 * Request discipline: counting `missingWeeks` needs only the snapshot
 * history, so the hook fetches NO provider data until `run()` is called.
 * The run then arms the year-long feeds (a slice of the shared canonical
 * merged-PR fetch) and waits for them — `preparing` is true meanwhile.
 * Before, the banner pulled 365 days of PRs + 90 days of events on every
 * dev page load even when no week was missing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { readSnapshots } from "./snapshots-store";
import { useSnapshots } from "./use-snapshots";
import { synthesiseWeek } from "./synthesise-week";
import { useGoals } from "@/features/goals";
import { useGoalSpecs } from "@/features/goal-specs";
import { readInputs, useAllGoalInputs } from "@/features/goal-inputs";
import { useDeferredFeeds } from "./use-deferred-feeds";
import { backfillFeedsNeeded, specsNeedJiraTickets } from "./snapshot-gates";
import { isoDaysAgo, weekKey } from "@/lib/date";

const DAY = 24 * 60 * 60 * 1000;
// GitHub's events feed caps at ~90d — that's the furthest back we
// can fetch event data for backfill. `synthesiseWeek` uses the same
// constant to mark older weeks as `partial: true` / `gaps: ["events"]`.
const EVENTS_HORIZON_DAYS = 90;

/**
 * @returns {{
 *   run:        () => Promise<void>,  // recompute ALL completed weeks
 *   isRunning:  boolean,
 *   progress:   { done: number, total: number } | null,
 *   missingWeeks: number,   // completed weeks with NO snapshot yet
 *   totalWeeks:   number,   // completed weeks since Jan 1 (refresh target)
 * }}
 */
export function useBackfill() {
  const { allGoals: goals } = useGoals(); // incl. shared goals
  const { specs } = useGoalSpecs();
  const [requested, setRequested] = useState(false);
  const { waitForFeeds } = useDeferredFeeds({
    armed: backfillFeedsNeeded({ requested }),
    mergedSince: isoDaysAgo(365),
    eventsSince: isoDaysAgo(EVENTS_HORIZON_DAYS),
    needJira: specsNeedJiraTickets(specs),
  });
  // Track the inputs store's tick so allInputs re-reads when that
  // (now API-direct) store hydrates after mount — a bare [] dep would
  // freeze allInputs to the pre-hydration empty map.
  const inputsTick = useAllGoalInputs();
  const allInputs = useMemo(
    () => readInputs(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inputsTick],
  );

  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const cancelledRef = useRef(false);

  // Subscribe to the snapshots store (reactive) AND trigger its one-shot
  // hydration. Without this, `missingWeeks` was computed once at mount
  // — before the async snapshot fetch resolved — and never recomputed,
  // so the banner perpetually read "N weeks missing" (every completed
  // week, since the store was still empty) even after snapshots loaded.
  const { snapshots } = useSnapshots();

  // Completed Sun → Thu weeks since Jan 1 with NO snapshot yet. Drives
  // the onboarding banner ("X weeks need backfill"). Recomputes whenever
  // the snapshots array changes (hydration / save / backfill run).
  //
  // Weeks that ended before the user's first tracker existed (or before
  // their hire date) are NOT missing — there was nothing to check in on.
  // They stay backfillable via `run`, they just don't nag.
  const trackingFloor = useMemo(() => trackingFloorMs(specs), [specs]);
  const missingWeeks = useMemo(() => {
    if (typeof window === "undefined") return 0;
    const ranges = enumerateCompletedWeeks();
    const existing = new Set((snapshots || []).map((s) => s.week));
    return ranges.filter(
      (r) => !existing.has(r.weekLabel) && (trackingFloor == null || r.end.getTime() > trackingFloor),
    ).length;
  }, [snapshots, isRunning, trackingFloor]);

  // Total completed weeks since Jan 1 — the refresh target count. A run
  // recomputes all of these, not just the missing ones.
  const totalWeeks = useMemo(() => {
    if (typeof window === "undefined") return 0;
    return enumerateCompletedWeeks().length;
  }, [isRunning]);

  const run = useCallback(async () => {
    if (isRunning) return;
    if (typeof window === "undefined") return;
    cancelledRef.current = false;
    setIsRunning(true);
    // Arm the provider feeds on demand and wait for them (instant when the
    // shared canonical lists are already cached).
    setRequested(true);
    setProgress(null);
    const { mrs, events, jira, settled, error } = await waitForFeeds();
    if (cancelledRef.current) return;
    // A failed PR feed would synthesise every week as "0 merged" — refuse.
    if (!settled || (error && !mrs)) {
      setIsRunning(false);
      toast.error("Couldn't load your PR history for the backfill — try again in a moment.");
      return;
    }

    // Recompute EVERY completed week — not just the ones missing a
    // snapshot. Preserve each week's existing `capturedBy` so the write
    // lands through matching server precedence (a fresh week defaults to
    // "auto"). synthesiseWeek preserves any hand-typed note.
    const ranges = enumerateCompletedWeeks();
    const existing = new Map(readSnapshots().map((s) => [s.week, s]));

    setProgress({ done: 0, total: ranges.length });

    for (let i = 0; i < ranges.length; i++) {
      if (cancelledRef.current) break;
      const range = ranges[i];
      const prior = existing.get(range.weekLabel);
      synthesiseWeek({
        range,
        goals,
        specs,
        mrs: mrs || [],
        events: events || [],
        tickets: Array.isArray(jira?.issues) ? jira.issues : [],
        allInputs,
        capturedBy: prior?.capturedBy ?? "auto",
      });
      setProgress({ done: i + 1, total: ranges.length });
      // Yield to the browser so the banner re-renders.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 0));
    }

    setIsRunning(false);
    setProgress(null);
    if (ranges.length > 0 && !cancelledRef.current) {
      toast.success(
        `Refreshed ${ranges.length} week${ranges.length === 1 ? "" : "s"} of history`,
      );
    }
  }, [goals, specs, waitForFeeds, allInputs, isRunning]);

  useEffect(
    () => () => {
      cancelledRef.current = true;
    },
    [],
  );

  // Between "Backfill" and the first synthesised week the run is waiting on
  // the provider feeds it just armed.
  const preparing = isRunning && !progress;
  return { run, isRunning, preparing, progress, missingWeeks, totalWeeks };
}

/* ─────────────── helpers ─────────────── */

/**
 * When check-ins started being owed at all (epoch ms), or null for "since
 * Jan 1" (no creation data): the EARLIEST tracker's creation time, floored
 * by the hire date — the same tracking-start facts the cadence windows use
 * (see goal-specs' store: specs arrive stamped with `createdAt`/`hireDate`).
 */
export function trackingFloorMs(specs) {
  let earliest = null;
  let hire = null;
  const list = specs instanceof Map ? [...specs.values()] : Object.values(specs || {});
  if (list.length === 0) return null;
  for (const spec of list) {
    const created = Date.parse(spec?.createdAt ?? "");
    // One tracker with no creation stamp means we can't claim anything
    // started late — keep the old "since Jan 1" behaviour.
    if (Number.isNaN(created)) return null;
    if (earliest == null || created < earliest) earliest = created;
    const h = Date.parse(spec?.hireDate ?? "");
    if (!Number.isNaN(h)) hire = h;
  }
  if (earliest == null) return null;
  return hire != null && hire > earliest ? hire : earliest;
}

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
      weekLabel: weekKey(new Date(start.getTime() + 3 * DAY)),
    });
    cursorSunday.setDate(cursorSunday.getDate() - 7);
  }
  return out;
}

// `synthesiseWeek` now lives in ./synthesise-week.js so the checkin
// page can call it directly when saving the active week.

"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  readSnapshots,
  saveSnapshot,
  SNAPSHOTS_CHANGE_EVENT,
} from "./snapshots-store";
import {
  avgReviewerComments,
  countMrComments,
  linkagePct,
  medianTurnaroundDays,
  mergedThisWeek,
  useCombinedEventsSince,
  useCombinedMergedSince,
} from "@/features/integrations";
import { buildDemoSnapshots, useDemoMode } from "@/features/demo-mode";
import { isoDaysAgo, weekLabel } from "@/lib/date";

function subscribe(callback) {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback();
  window.addEventListener(SNAPSHOTS_CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(SNAPSHOTS_CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

function getSnapshot() {
  return JSON.stringify(readSnapshots());
}
function getServerSnapshot() {
  return "[]";
}

export function useSnapshots() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const real = JSON.parse(raw);
  const demo = useDemoMode();
  const demoSnaps = useMemo(() => (demo ? buildDemoSnapshots() : null), [demo]);

  // In demo mode, ALWAYS return the synthetic series. Real snapshots
  // stay in localStorage (this hook never writes), so toggling demo
  // off restores them. The override has to be unconditional because
  // demo-mode goals/specs use demo goal-ids; if real snapshots leaked
  // through, their goalReadings wouldn't match and every compare-table
  // cell would render "—".
  if (demo) {
    return { snapshots: demoSnaps };
  }
  return { snapshots: real };
}

/**
 * Captures a snapshot from the currently-loaded live metrics.
 * Returns a callback the UI can bind to a "Snapshot now" button.
 */
export function useSnapshotNow() {
  const { data: mrs } = useCombinedMergedSince(isoDaysAgo(30));
  const { data: events } = useCombinedEventsSince(isoDaysAgo(30));

  return useCallback(
    (note = "") => {
      const mergedThisW = mergedThisWeek(mrs || []).count;
      const reviews = countMrComments(events || []);
      const median = medianTurnaroundDays(mrs || []);
      const linkage = linkagePct(mrs || [])?.pct ?? 0;
      const rounds = avgReviewerComments(mrs || []) ?? 0;
      const week = weekLabel();
      saveSnapshot({
        week,
        capturedAt: new Date().toISOString(),
        merged: mergedThisW,
        reviews,
        turnaround: median == null ? 0 : Math.round(median * 24),
        linkage,
        rounds: Math.round(rounds * 10) / 10,
        note: note.trim(),
      });
      toast.success(`Snapshot saved — ${week}`);
    },
    [mrs, events],
  );
}

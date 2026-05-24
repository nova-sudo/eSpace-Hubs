"use client";

import { useCallback, useSyncExternalStore } from "react";
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
  const snapshots = JSON.parse(raw);
  return { snapshots };
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

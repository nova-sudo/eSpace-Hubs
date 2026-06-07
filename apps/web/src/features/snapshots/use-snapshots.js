"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  fetchSnapshots,
  getSnapshotsServerSnapshot,
  getSnapshotsSnapshot,
  getSnapshotsState,
  readSnapshots,
  saveSnapshot,
  subscribeSnapshots,
} from "./snapshots-store";
import { useSession } from "@/features/auth";
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

/**
 * Subscribe to the in-memory snapshots store + trigger a one-shot
 * hydration on first mount per session.
 *
 * The fetch is idempotent — concurrent useSnapshots consumers across
 * the page share the in-flight promise inside the store, so only one
 * GET fires per session establishment regardless of how many tiles
 * read snapshots.
 */
export function useSnapshots() {
  // useSyncExternalStore drives re-renders whenever the store's tick
  // increments. The actual data comes from readSnapshots() in the
  // render body — the tick is just a "data changed" signal.
  useSyncExternalStore(
    subscribeSnapshots,
    getSnapshotsSnapshot,
    getSnapshotsServerSnapshot,
  );

  // Trigger the one-shot per-session hydration. Gated on session
  // user.id so the next user's mount sees a fresh fetch (the
  // auth-transition listener inside the store resets `fetched` to
  // false on logout).
  const { user, loading: sessionLoading } = useSession();
  useEffect(() => {
    if (sessionLoading || !user) return;
    const s = getSnapshotsState();
    if (s.fetched || s.loading) return;
    void fetchSnapshots();
  }, [user, sessionLoading]);

  // `fetched` flips true once the first load settles (even with zero
  // snapshots), so consumers can gate empty-state vs loader.
  const s = getSnapshotsState();
  return { snapshots: readSnapshots(), fetched: s.fetched, loading: s.loading };
}

/**
 * Captures a snapshot from the currently-loaded live metrics.
 * Returns a callback the UI can bind to a "Snapshot now" button.
 *
 * Writes through `saveSnapshot()` which is now API-direct — the
 * server's manual-wins-over-auto rule reconciles the response and
 * the local store updates with whatever the server accepted.
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
      void saveSnapshot({
        week,
        capturedAt: new Date().toISOString(),
        capturedBy: "manual",
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

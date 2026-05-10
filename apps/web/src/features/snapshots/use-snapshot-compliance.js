"use client";

/**
 * `useSnapshotCompliance(goalId)` — React binding around `goalCompliance`.
 *
 * Reads the snapshot stream from `useSnapshots()` and runs the per-goal
 * compliance walk. Re-fires when the snapshot store changes (new auto
 * capture, manual snapshot, demo toggle), so widget compliance numbers
 * tick up week-by-week without callers wiring their own subscriptions.
 *
 * Returned shape mirrors `goalCompliance(...)`:
 *   {
 *     pct,             // null until at least one CLOSED window has a windowMet boolean
 *     metWindows,
 *     totalWindows,    // closed windows only
 *     cadence,
 *     inProgress,      // current/open window — not counted in pct
 *     windows,         // all windows (closed + in-progress), newest first
 *   }
 *
 * "Closed" vs "in progress":
 *   - Weekly cadence: every snapshot is its own closed window the moment
 *     the next week's snapshot lands. The current week's reading is
 *     `inProgress` until next Thursday.
 *   - Monthly cadence: the current month's reading is `inProgress`;
 *     prior months are closed once the calendar rolls.
 *   - Quarterly: same idea.
 */

import { useMemo } from "react";
import { useSnapshots } from "./use-snapshots";
import { goalCompliance } from "./compliance";

export function useSnapshotCompliance(goalId) {
  const { snapshots } = useSnapshots();
  return useMemo(
    () => goalCompliance(snapshots, goalId),
    [snapshots, goalId],
  );
}

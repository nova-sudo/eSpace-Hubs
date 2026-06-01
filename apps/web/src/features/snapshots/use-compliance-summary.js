"use client";

/**
 * Aggregate goal-compliance across every tracked goal in the snapshot
 * stream — the data behind the Overview "Goal compliance" tile.
 *
 * Returns `{ met, assessable, pct }`:
 *   - assessable: goals with a boolean compliance signal (excludes
 *     delegated goals, goals with no target, and goals with no readings
 *     yet — none of which can be judged on-pace).
 *   - met: assessable goals currently on pace / meeting target.
 *   - pct: round(met / assessable * 100), or null when nothing is
 *     assessable yet.
 *
 * Per-goal standing prefers the IN-PROGRESS window's `onPace`/`windowMet`
 * (the current cycle's standing); when a goal has only closed history it
 * falls back to the most recent closed window's `windowMet`.
 */

import { useMemo } from "react";
import { useSnapshots } from "./use-snapshots";
import { goalCompliance } from "./compliance";

function currentStanding(c) {
  if (!c) return null;
  if (c.inProgress) {
    if (c.inProgress.onPace != null) return c.inProgress.onPace === true;
    if (c.inProgress.windowMet != null) return c.inProgress.windowMet === true;
  }
  // windows are newest-first → first closed window with a boolean is the
  // most recent authoritative reading.
  for (const w of c.windows || []) {
    if (w.closed && w.reading?.windowMet != null) {
      return w.reading.windowMet === true;
    }
  }
  return null;
}

export function useComplianceSummary() {
  const { snapshots } = useSnapshots();
  return useMemo(() => {
    const ids = new Set();
    for (const s of snapshots) {
      const readings = s?.goalReadings;
      if (readings) for (const id of Object.keys(readings)) ids.add(id);
    }
    let met = 0;
    let assessable = 0;
    for (const id of ids) {
      const standing = currentStanding(goalCompliance(snapshots, id));
      if (standing == null) continue;
      assessable += 1;
      if (standing) met += 1;
    }
    return {
      met,
      assessable,
      pct: assessable > 0 ? Math.round((met / assessable) * 100) : null,
    };
  }, [snapshots]);
}

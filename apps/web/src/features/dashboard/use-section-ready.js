"use client";

/**
 * Readiness of the data sources behind the performance-page sections.
 *
 * Each section shows ONE big loader until every card it contains has its
 * data, then reveals all at once (instead of each card flashing its own
 * loading → empty → data). This hook computes the shared "is that source
 * loaded yet?" flags; each section ANDs the ones it actually uses.
 *
 *   integrationsReady — combined merged PRs + events for the active date
 *                       range have settled (false only during the FIRST
 *                       fetch; a disconnected provider is `true` instantly
 *                       because its SWR key is null → never stuck).
 *   snapshotsReady    — the snapshot stream has hydrated.
 *   goalsReady        — goals + specs + inputs have hydrated (the goal
 *                       compliance tile).
 *
 * The combined hooks are called with the SAME `since` the tiles use, so
 * SWR's dedupe means this shares their in-flight fetch — no extra request.
 */

import {
  useCombinedMergedSince,
  useCombinedEventsSince,
} from "@/features/integrations";
import { useSnapshots, useComplianceSummary } from "@/features/snapshots";
import { useDateRange } from "./date-range";

export function usePerfSources() {
  const { range } = useDateRange();
  const since = range?.fetchSince;

  const merged = useCombinedMergedSince(since);
  const events = useCombinedEventsSince(since);
  const { fetched: snapshotsReady } = useSnapshots();
  const { ready: goalsReady } = useComplianceSummary();

  return {
    integrationsReady: !merged.isLoading && !events.isLoading,
    snapshotsReady,
    goalsReady,
  };
}

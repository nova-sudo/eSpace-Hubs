"use client";

/**
 * `<LiveValue>` status for an AUTO source (`spec.source`), from the
 * `useDataSource` result the tile already holds. One place decides which
 * providers a metric is made of, what "the feed has answered" means for it,
 * and where the last-known value comes from — so the Goals tile, the Home
 * row and the focus hero show the same number in the same state.
 */

import { useLiveStatus } from "@/features/integrations";
import { SOURCE_METRICS } from "@/features/goal-specs";

const CI_METRICS = new Set([
  SOURCE_METRICS.DEPLOY_FREQUENCY,
  SOURCE_METRICS.LEAD_TIME,
  SOURCE_METRICS.BUILD_PASS_RATE,
]);

/** Rate-limit provider ids a source's number depends on. */
export function providersForSource(source) {
  const metric = source?.metric;
  if (!metric) return [];
  if (metric === SOURCE_METRICS.TICKET_CYCLE_TIME) return ["jira"];
  if (CI_METRICS.has(metric)) return [source.provider === "jenkins" ? "jenkins" : "github"];
  const hosts =
    source.provider === "github" ? ["github"] : source.provider === "gitlab" ? ["gitlab"] : ["github", "gitlab"];
  return metric === SOURCE_METRICS.TICKET_TYPE_SHARE ? [...hosts, "jira"] : hosts;
}

/**
 * @param {object|null} source   spec.source
 * @param {object} ds            the useDataSource() result
 * @param {{hasValue: boolean, emptyLabel?: string}} opts
 */
export function useSourceLiveStatus(source, ds, { hasValue, emptyLabel } = {}) {
  const metric = source?.metric;
  const providers = providersForSource(source);
  // "Answered": the merged/ticket feeds report a sample once they resolve
  // (null while nothing has arrived). CI feeds always report a number, so
  // for those only the hook's own loading flag says anything.
  const dataReady = CI_METRICS.has(metric)
    ? !ds?.isLoading
    : ds?.provenance
      ? ds.provenance.sample != null
      : !ds?.isLoading;
  return useLiveStatus({
    providers,
    hasValue,
    dataReady,
    isLoading: ds?.isLoading,
    error: ds?.error || null,
    fetchedAt: ds?.provenance?.fetchedAt ?? null,
    emptyLabel,
  });
}

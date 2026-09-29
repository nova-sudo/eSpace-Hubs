"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
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
  useIntegrations,
} from "@/features/integrations";
import { isoDaysAgo, weekKey } from "@/lib/date";

/** The gap tag a capture carries when it has no PR / review numbers. */
export const PROVIDER_METRICS_GAP = "provider-metrics";

/** Code hosts whose feeds the PR numbers come from. */
const CODE_HOSTS = ["github", "gitlab"];

/**
 * True when a snapshot has no real PR / review numbers (captured without a
 * code host, or by the weekly server job). Its 0s are "unknown", not zero —
 * the page renders them as "—".
 */
export function lacksProviderMetrics(s) {
  return Boolean(s && Array.isArray(s.gaps) && s.gaps.includes(PROVIDER_METRICS_GAP));
}

/** `{ known, loading }` — is any code host connected (known once fetched). */
function useCodeHostConnected() {
  const { connectedProviders, integrationsLoading } = useIntegrations();
  const connected = connectedProviders.some((id) => CODE_HOSTS.includes(id));
  return { connected, loading: Boolean(integrationsLoading) };
}

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
  return {
    snapshots: readSnapshots(),
    fetched: s.fetched,
    loading: s.loading,
    // Last fetch/write error envelope — pages render "Couldn't load —
    // Retry" from this instead of a blank page.
    error: s.error,
    retry: fetchSnapshots,
  };
}

/**
 * Whether a manual "Snapshot now" would record real numbers right now.
 *
 * The capture reads the merged-MR + events feeds; until both SWR hooks
 * have resolved, a capture would freeze zeros for the week. Callers use
 * `ready` to disable the button and `reason` for the hint next to it.
 * (Companion-offline detection lives with the caller — the companion
 * store is a platform utility the page can read, this hook shouldn't.)
 */
export function useSnapshotReadiness() {
  const { data: mrs, error: mrsError, isLoading: mrsLoading } =
    useCombinedMergedSince(isoDaysAgo(30));
  const { data: events, error: eventsError, isLoading: eventsLoading } =
    useCombinedEventsSince(isoDaysAgo(30));
  const loading = (mrs === undefined && !mrsError) || (events === undefined && !eventsError)
    || Boolean(mrsLoading) || Boolean(eventsLoading);
  const failed = Boolean(mrsError || eventsError);
  const { fetched } = useSnapshots();
  const codeHost = useCodeHostConnected();
  // No code host at all: the PR feeds never resolve, so waiting on them was
  // an endless "Waiting for your PR data…". Manual trackers can still be
  // captured — the PR columns are stored as unknown ("—"), not zero.
  const noCodeHost = !codeHost.loading && !codeHost.connected;
  let reason = null;
  if (!fetched) reason = "Loading your snapshot history…";
  else if (noCodeHost) {
    reason = "Connect GitHub or GitLab to capture PR numbers — manual trackers are captured anyway.";
  } else if (loading) reason = "Waiting for your PR data to load…";
  else if (failed) reason = "Provider data failed to load — a capture now would record zeros.";
  const ready = fetched && (noCodeHost || (!loading && !failed));
  return { ready, loading: noCodeHost ? false : loading, failed, reason, noCodeHost };
}

/**
 * Captures a snapshot from the currently-loaded live metrics.
 * Returns a callback the UI can bind to a "Snapshot now" button; the
 * callback resolves to `{ ok, error }` (see `saveSnapshot`) so callers
 * toast from the actual outcome.
 *
 * The capture is keyed to the CURRENT week (`weekKey()`), as manual.
 * Existing goalReadings / note for that week are carried forward — the
 * server merges too — so a mid-week or weekend capture never blanks the
 * weekly readings the auto-capture recorded.
 */
export function useSnapshotNow() {
  const { data: mrs } = useCombinedMergedSince(isoDaysAgo(30));
  const { data: events } = useCombinedEventsSince(isoDaysAgo(30));
  const codeHost = useCodeHostConnected();
  const noCodeHost = !codeHost.loading && !codeHost.connected;

  return useCallback(
    async (note = "") => {
      const week = weekKey();
      const existing = readSnapshots().find((s) => s.week === week);
      if (noCodeHost) {
        // Nothing to read PR numbers from — record the week (manual
        // trackers, note) with the provider columns marked unknown.
        return saveSnapshot({
          week,
          capturedAt: new Date().toISOString(),
          capturedBy: "manual",
          merged: 0,
          reviews: 0,
          turnaround: 0,
          linkage: 0,
          rounds: 0,
          note: (typeof note === "string" ? note : "").trim() || existing?.note || "",
          goalReadings: existing?.goalReadings || {},
          partial: true,
          gaps: [PROVIDER_METRICS_GAP],
        });
      }
      // Refuse rather than freeze zeros: every caller (page, palette,
      // home tile) is protected without each re-checking the feeds.
      if (!mrs || !events) {
        return {
          ok: false,
          error: {
            code: "not_ready",
            message: "Integration data is still loading",
          },
        };
      }
      const mergedThisW = mergedThisWeek(mrs).count;
      const reviews = countMrComments(events);
      const median = medianTurnaroundDays(mrs);
      const linkage = linkagePct(mrs)?.pct ?? 0;
      const rounds = avgReviewerComments(mrs) ?? 0;
      // Return the promise so the button can hold a pending state —
      // fire-and-forget made "Snapshot now" double-clickable (#239).
      return saveSnapshot({
        week,
        capturedAt: new Date().toISOString(),
        capturedBy: "manual",
        merged: mergedThisW,
        reviews,
        turnaround: median == null ? 0 : Math.round(median * 24),
        linkage,
        rounds: Math.round(rounds * 10) / 10,
        note: (typeof note === "string" ? note : "").trim() || existing?.note || "",
        goalReadings: existing?.goalReadings || {},
      });
    },
    [mrs, events, noCodeHost],
  );
}

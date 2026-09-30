"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  useCombinedEventsSince,
  useCombinedMergedSince,
  useJiraTickets,
} from "@/features/integrations";

/** How long a lazy capture waits for its feeds before giving up. */
export const FEEDS_WAIT_MS = 60_000;

/**
 * Provider feeds (merged PRs, events, optionally Jira) that are only
 * fetched once `armed` — the snapshot machinery's answer to "don't pay for
 * data nobody is about to use".
 *
 * Before this, the command palette (every page, every hub), the weekly
 * auto-snapshot runner and the backfill banner each subscribed to their
 * own provider windows on mount, whether or not a capture would ever run.
 * Now each passes `armed = false` until a capture is actually wanted (the
 * command is invoked, this week's snapshot is missing, the user opens the
 * backfill) and awaits `waitForFeeds()`.
 *
 * Arming only subscribes to the SHARED canonical provider keys (see
 * integrations' `provider-windows.js`), so when another surface already
 * loaded them the feeds resolve from cache with no request at all.
 *
 * `settled` is true once every armed feed has finished (data or error, or
 * skipped because the provider isn't connected).
 */
export function useDeferredFeeds({ armed, mergedSince, eventsSince, needJira = false }) {
  const merged = useCombinedMergedSince(armed ? mergedSince : null);
  const events = useCombinedEventsSince(armed ? eventsSince : null);
  const jira = useJiraTickets(Boolean(armed && needJira));

  const settled =
    Boolean(armed) && !merged.isLoading && !events.isLoading && !jira.isLoading;
  const error = merged.error || events.error || (needJira ? jira.error : null) || null;

  const latest = { mrs: merged.data, events: events.data, jira: jira.data, error, settled };
  const latestRef = useRef(latest);
  latestRef.current = latest;
  const waitersRef = useRef([]);

  useEffect(() => {
    if (!settled || waitersRef.current.length === 0) return;
    const waiters = waitersRef.current;
    waitersRef.current = [];
    for (const w of waiters) w.resolve(latestRef.current);
  }, [settled, merged.data, events.data, jira.data, error]);

  // Unmount: release anyone still waiting so a pending capture can't hang.
  useEffect(
    () => () => {
      const waiters = waitersRef.current;
      waitersRef.current = [];
      for (const w of waiters) w.resolve({ ...latestRef.current, settled: false, aborted: true });
    },
    [],
  );

  /**
   * Resolve with `{ mrs, events, jira, error, settled }` once the feeds
   * settle (immediately when they already have). The caller must have set
   * `armed` (or be about to in the same tick). Times out after
   * FEEDS_WAIT_MS with `settled: false`.
   */
  const waitForFeeds = useCallback((timeoutMs = FEEDS_WAIT_MS) => {
    if (latestRef.current.settled) return Promise.resolve(latestRef.current);
    return new Promise((resolve) => {
      const waiter = { resolve: () => {} };
      const timer = setTimeout(() => {
        waitersRef.current = waitersRef.current.filter((w) => w !== waiter);
        resolve({ ...latestRef.current, settled: false, timedOut: true });
      }, timeoutMs);
      waiter.resolve = (v) => {
        clearTimeout(timer);
        resolve(v);
      };
      waitersRef.current.push(waiter);
    });
  }, []);

  return {
    mrs: merged.data,
    events: events.data,
    jira: jira.data,
    error,
    settled,
    isLoading: Boolean(armed) && !settled,
    waitForFeeds,
  };
}

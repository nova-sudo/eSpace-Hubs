"use client";

/**
 * Per-section readiness for the performance page. Each section shows one
 * big loader until EVERY card it contains has its data, then reveals at
 * once — so no card flashes its own loading → empty → data.
 *
 * Each hook gates on the EXACT data hooks that section's tiles call (same
 * args → SWR dedupe shares the tiles' in-flight fetch; no extra request).
 * Gating on the wrong hook is what made a section reveal early — e.g. the
 * review-timing tile does per-PR fetching AFTER the merged list, so it
 * must gate on `usePrReviewTimings`, not raw merged. A disconnected
 * provider reports ready instantly (its SWR key is null), so a user with
 * no integrations never sits on a stuck loader.
 */

import {
  useCombinedMergedSince,
  useCombinedEventsSince,
  usePrReviewTimings,
  useJiraTickets,
  useGitlabOpenMRs,
  useGitlabReviewRequests,
  useGithubOpenPulls,
  useGithubReviewRequests,
} from "@/features/integrations";
import { useComplianceSummary } from "@/features/snapshots";
import { useDateRange } from "./date-range";

/** Overview — goal compliance + merged-PR metrics (merged / rounds / linkage). */
export function useOverviewReady() {
  const { range } = useDateRange();
  const { ready: goalsReady } = useComplianceSummary();
  const { isLoading: merged } = useCombinedMergedSince(range?.fetchSince);
  return goalsReady && !merged;
}

/** Review timing — the dedicated per-PR review-timing fetch. */
export function useReviewTimingReady() {
  const { range } = useDateRange();
  const { isLoading } = usePrReviewTimings(range?.fetchSince);
  return !isLoading;
}

/** Glance — Jira tickets + open PRs/MRs + review requests. */
export function useGlanceReady() {
  const { isLoading: tickets } = useJiraTickets();
  const { isLoading: glOpen } = useGitlabOpenMRs();
  const { isLoading: ghOpen } = useGithubOpenPulls();
  const { isLoading: glReq } = useGitlabReviewRequests();
  const { isLoading: ghReq } = useGithubReviewRequests();
  return !tickets && !glOpen && !ghOpen && !glReq && !ghReq;
}

/** Trends — merged-PR + event metrics (heatmap/activity/reviews=events, turnaround=merged). */
export function useTrendReady() {
  const { range } = useDateRange();
  const { isLoading: merged } = useCombinedMergedSince(range?.fetchSince);
  const { isLoading: events } = useCombinedEventsSince(range?.fetchSince);
  return !merged && !events;
}

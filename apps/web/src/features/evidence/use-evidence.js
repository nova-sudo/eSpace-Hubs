"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  fetchEvidence,
  getEvidenceServerSnapshot,
  getEvidenceSnapshot,
  getEvidenceState,
  readStarred,
  subscribeEvidence,
  toggleStar,
} from "./evidence-store";
import { useSession } from "@/features/auth";
import {
  useCombinedMergedSince,
  useJiraTickets,
} from "@/features/integrations";
import { isoDaysAgo } from "@/lib/date";

/**
 * Subscribe to the in-memory evidence store + trigger a one-shot
 * hydration on first mount per session. Same pattern as
 * useSnapshots / useGradedPrs — idempotent fetch, in-flight promise
 * is shared across concurrent consumers.
 */
export function useStarredEvidence() {
  useSyncExternalStore(
    subscribeEvidence,
    getEvidenceSnapshot,
    getEvidenceServerSnapshot,
  );
  const { user, loading: sessionLoading } = useSession();
  useEffect(() => {
    if (sessionLoading || !user) return;
    const s = getEvidenceState();
    if (s.fetched || s.loading) return;
    void fetchEvidence();
  }, [user, sessionLoading]);
  return readStarred();
}

/**
 * Candidates shown in the picker — recent merged MRs and recently-closed
 * Jira tickets the user hasn't yet starred.
 */
export function useEvidenceCandidates() {
  const { data: merged } = useCombinedMergedSince(isoDaysAgo(90));
  const { data: tickets } = useJiraTickets();
  const starred = useStarredEvidence();
  const starredIds = new Set(starred.map((s) => s.id));

  const mergedCandidates = (merged || []).slice(0, 12).map((m) => ({
    id: `mr-${m.id}`,
    kind: "merged-pr",
    ref: `!${m.iid}`,
    title: m.title,
    date: shortDate(m.merged_at),
    impact: "",
  }));

  const ticketCandidates = (tickets?.issues || [])
    .filter((i) => i.fields?.status?.statusCategory?.key === "done")
    .slice(0, 6)
    .map((i) => ({
      id: `ticket-${i.id}`,
      kind: "ticket",
      ref: i.key,
      title: i.fields?.summary,
      date: shortDate(i.fields?.updated),
      impact: "",
    }));

  return [...mergedCandidates, ...ticketCandidates].filter(
    (c) => !starredIds.has(c.id),
  );
}

export function toggleEvidence(item) {
  toggleStar(item);
}

function shortDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

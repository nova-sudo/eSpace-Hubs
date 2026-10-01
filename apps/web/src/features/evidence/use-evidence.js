"use client";

import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
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
 * Jira tickets the user hasn't yet starred. `enabled: false` skips the
 * Jira request (pass the picker's open state).
 */
export function useEvidenceCandidates({ enabled = true } = {}) {
  const { data: merged } = useCombinedMergedSince(isoDaysAgo(90));
  // The Jira list is only read while the picker is open — not on every
  // Evidence load.
  const { data: tickets } = useJiraTickets(enabled);
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

/**
 * Star / unstar with a visible outcome — the store rolls back silently
 * on failure, which used to look like the click did nothing.
 */
export async function toggleEvidence(item) {
  const wasStarred = readStarred().some((x) => x.id === item?.id);
  const r = await toggleStar(item);
  if (r?.ok === false) {
    const what = item?.ref || item?.title || "this item";
    toast.error(
      `Couldn't ${wasStarred ? "remove" : "star"} ${what}: ${r.error?.message || "the server didn't respond"}`,
      { action: { label: "Retry", onClick: () => void toggleEvidence(item) } },
    );
  }
  return r;
}

function shortDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

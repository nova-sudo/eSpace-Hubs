"use client";

import { useSyncExternalStore } from "react";
import {
  EVIDENCE_CHANGE_EVENT,
  readStarred,
  toggleStar as storeToggle,
} from "./evidence-store";
import {
  useCombinedMergedSince,
  useJiraTickets,
} from "@/features/integrations";
import { isoDaysAgo } from "@/lib/date";

function subscribe(callback) {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback();
  window.addEventListener(EVIDENCE_CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVIDENCE_CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
function getSnapshot() {
  return JSON.stringify(readStarred());
}
function getServerSnapshot() {
  return "[]";
}

export function useStarredEvidence() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return JSON.parse(raw);
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
  storeToggle(item);
}

function shortDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

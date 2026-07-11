"use client";

/**
 * Receipts feed — "everything you shipped" as a chronological, day-grouped
 * timeline of individual receipts, plus the running tally for the sidebar.
 *
 * Normalizes three real streams the app already fetches into one sorted list:
 *   - PR      merged MRs        (useCombinedMergedSince → merged_at)
 *   - TICKET  closed Jira issues (useJiraTickets → resolutiondate/updated)
 *   - REVIEW  comment events on MRs (useCombinedEventsSince → created_at)
 *
 * Reviews are surfaced as individual items here (the rest of the app only
 * counts them). GitLab review events carry the reviewed MR's title; GitHub
 * events are stripped to a count, so those fall back to a generic label.
 *
 * Coverage bars are computed separately (coverageByL1) from useGoalReadings —
 * this hook owns the receipt stream + tally only.
 */

import { useMemo } from "react";
import {
  countMrComments,
  fmtDurationHours,
  medianTurnaroundDays,
  mergedWithin,
  useCombinedEventsSince,
  useCombinedMergedSince,
  useJiraTickets,
} from "@/features/integrations";
import { isoDaysAgo, DAY_MS } from "@/lib/date";
import { jiraKeyFrom, knownProjectsFrom } from "./receipt-goal-link";

const TYPE = { PR: "PR", TICKET: "TICKET", REVIEW: "REVIEW" };

function timeLabel(ts) {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Day-group label: "Today · Jul 9" / "Yesterday · Jul 8" / "Mon Jul 7". */
function dayLabel(ts, now) {
  const d = new Date(ts);
  const startOf = (x) => {
    const c = new Date(x);
    c.setHours(0, 0, 0, 0);
    return c.getTime();
  };
  const diffDays = Math.round((startOf(now) - startOf(ts)) / DAY_MS);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (diffDays <= 0) return `Today · ${date}`;
  if (diffDays === 1) return `Yesterday · ${date}`;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function useReceiptsFeed(days = 90) {
  const { data: merged, isLoading: mLoading } = useCombinedMergedSince(isoDaysAgo(days));
  const { data: events, isLoading: eLoading } = useCombinedEventsSince(isoDaysAgo(days));
  const { data: tickets, isLoading: tLoading } = useJiraTickets();

  return useMemo(() => {
    const now = Date.now();
    const cutoff = now - days * DAY_MS;
    const mergedInRange = mergedWithin(merged || [], days);
    // Real Jira projects, so we only tag PR/review receipts that reference an
    // actual ticket (not "AES-256"/"SHA-256"). Tickets carry their own key.
    const known = knownProjectsFrom(tickets);

    const receipts = [];

    // PRs
    for (const m of mergedInRange) {
      const ts = m.merged_at ? new Date(m.merged_at).getTime() : null;
      if (ts == null) continue;
      const notes = Number(m.user_notes_count) || 0;
      receipts.push({
        id: `pr-${m.id ?? m.iid}`,
        kind: TYPE.PR,
        title: m.title || `Merge request !${m.iid}`,
        meta: `${m.source || "gitlab"}${m.iid ? ` · !${m.iid}` : ""}${notes ? ` · ${notes} comments` : ""}`,
        ts,
        time: timeLabel(ts),
        goalTag: jiraKeyFrom(known, m.title, m.source_branch, m.description),
        href: m.web_url || null,
      });
    }

    // Tickets — done, within range
    for (const i of tickets?.issues || []) {
      if (i?.fields?.status?.statusCategory?.key !== "done") continue;
      const raw = i.fields.resolutiondate || i.fields.updated;
      const ts = raw ? new Date(raw).getTime() : null;
      if (ts == null || ts < cutoff) continue;
      receipts.push({
        id: `tk-${i.id ?? i.key}`,
        kind: TYPE.TICKET,
        title: i.fields.summary || i.key,
        meta: `jira · ${i.key}`,
        ts,
        time: timeLabel(ts),
        goalTag: i.key || null,
        href: null,
      });
    }

    // Reviews — comment events on MRs
    let reviewSeq = 0;
    for (const e of events || []) {
      const action = e.action_name;
      const isComment = action === "commented on" || action === "commented";
      if (!isComment || e.target_type !== "MergeRequest") continue;
      const raw = e.created_at;
      const ts = raw ? new Date(raw).getTime() : null;
      if (ts == null || ts < cutoff) continue;
      const target = e.target_title || null;
      receipts.push({
        id: `rv-${reviewSeq++}-${ts}`,
        kind: TYPE.REVIEW,
        title: target ? `Reviewed: ${target}` : "Reviewed a merge request",
        meta: `${e.source || "gitlab"} · commented`,
        ts,
        time: timeLabel(ts),
        goalTag: jiraKeyFrom(known, target),
        href: null,
      });
    }

    receipts.sort((a, b) => b.ts - a.ts);

    // Group consecutive receipts by calendar day.
    const groups = [];
    let current = null;
    for (const r of receipts) {
      const label = dayLabel(r.ts, now);
      if (!current || current.label !== label) {
        current = { label, items: [] };
        groups.push(current);
      }
      current.items.push(r);
    }

    const reviewCount = countMrComments(events || []);
    const ticketCount = receipts.filter((r) => r.kind === TYPE.TICKET).length;
    const tally = [
      { label: "Merged PRs", value: String(mergedInRange.length) },
      { label: "Tickets closed", value: String(ticketCount) },
      { label: "Reviews given", value: String(reviewCount) },
      { label: "Median turnaround", value: fmtDurationHours(medianTurnaroundDays(mergedInRange)) },
    ];

    return {
      groups,
      tally,
      totalReceipts: receipts.length,
      loading: mLoading || eLoading || tLoading,
    };
  }, [merged, events, tickets, days, mLoading, eLoading, tLoading]);
}

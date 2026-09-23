"use client";

import { useMemo } from "react";
import { jiraApi } from "../api-clients";
import { mrJiraKeys } from "../metrics/ticket-type";
import { useIntegrations } from "../use-integrations";
import { useSwrIf } from "./use-swr-if";

/**
 * Attach `jira_issue_types` (`{ KEY: "bug" }`) to merged-MR rows that
 * reference a Jira key, for TICKET_TYPE_SHARE.
 *
 * Keys are collected across the list, de-duped, and resolved in JQL
 * batches of BATCH (`key in (...)`) — so a year of PRs is a handful of
 * requests, not one per PR. Capped at CAP keys, newest merges first;
 * rows past the cap stay unresolved and provenance says how many.
 *
 * Pass `null` to skip entirely (other metrics shouldn't spend the Jira
 * rate limit). Rows are untouched when Jira isn't connected — the widget
 * reads "unresolved" for all of them and says why.
 */
const CAP = 200;
const BATCH = 50;

export function useJiraIssueTypes(mrs) {
  const { isConnected } = useIntegrations();
  const connected = isConnected("jira");

  const { keys, beyondCap } = useMemo(() => {
    if (!Array.isArray(mrs)) return { keys: [], beyondCap: 0 };
    const ordered = [...mrs].sort(
      (a, b) => new Date(b?.merged_at || 0).getTime() - new Date(a?.merged_at || 0).getTime(),
    );
    const all = [];
    for (const m of ordered) {
      for (const k of mrJiraKeys(m)) if (!all.includes(k)) all.push(k);
    }
    return { keys: all.slice(0, CAP), beyondCap: Math.max(0, all.length - CAP) };
  }, [mrs]);

  const key = connected && keys.length > 0 ? `jira:issue-types:${[...keys].sort().join(",")}` : null;

  const swr = useSwrIf(Boolean(key), key, async () => {
    const out = {};
    for (let i = 0; i < keys.length; i += BATCH) {
      const chunk = keys.slice(i, i + BATCH);
      try {
        Object.assign(out, await jiraApi.issueTypesForKeys(chunk));
      } catch {
        // A failed batch leaves its keys unresolved rather than failing
        // the whole reading; the widget reports the unresolved count.
      }
    }
    return out;
  });

  const data = useMemo(() => {
    if (!Array.isArray(mrs)) return mrs;
    const types = swr.data;
    if (!types) return mrs;
    return mrs.map((m) => {
      const own = {};
      for (const k of mrJiraKeys(m)) if (types[k]) own[k] = types[k];
      return Object.keys(own).length > 0 ? { ...m, jira_issue_types: own } : m;
    });
  }, [mrs, swr.data]);

  return {
    data,
    isLoading: Boolean(key) && swr.isLoading,
    error: swr.error || null,
    beyondCap,
    connected,
    fetchedAt: swr.fetchedAt ?? null,
  };
}

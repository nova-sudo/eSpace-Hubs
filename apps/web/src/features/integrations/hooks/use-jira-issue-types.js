"use client";

import { useMemo } from "react";
import { useSWRConfig } from "swr";
import { jiraApi } from "../api-clients";
import { mrJiraKeys } from "../metrics/ticket-type";
import { useIntegrations } from "../use-integrations";
import { useSwrIf } from "./use-swr-if";
import { readCachedItem, writeCachedItem } from "./per-item-cache";

/**
 * Attach `jira_issue_types` (`{ KEY: "bug" }`) to merged-MR rows that
 * reference a Jira key, for TICKET_TYPE_SHARE.
 *
 * Keys are collected across the list, de-duped, and resolved in JQL
 * batches of BATCH (`key in (...)`) — so a year of PRs is a handful of
 * requests, not one per PR. Capped at CAP keys, newest merges first;
 * rows past the cap stay unresolved and provenance says how many.
 *
 * Caching is PER KEY (`jira:issue-type:<KEY>`, see `per-item-cache.js`):
 *   - a newly merged PR only sends the batch holding its own new key(s),
 *     never the whole set again;
 *   - a key Jira didn't return (other project, no permission) is cached as
 *     "" so it isn't re-asked on every load;
 *   - a batch that FAILS (rate limited after retries, network) caches
 *     nothing for its keys and makes the fetch throw, so SWR records an
 *     error instead of a partial success. The keys resolved by the other
 *     batches are already cached and shown; the failed batch is retried by
 *     SWR's error retry (and by any later load), and only that batch goes
 *     back on the wire.
 *
 * Pass `null` to skip entirely (other metrics shouldn't spend the Jira
 * rate limit). Rows are untouched when Jira isn't connected — the widget
 * reads "unresolved" for all of them and says why.
 */
const CAP = 200;
const BATCH = 50;

/** Per-key cache entry — the lower-cased issue type, or "" for "not visible". */
export function issueTypeKey(jiraKey) {
  return `jira:issue-type:${jiraKey}`;
}

/** Split `keys` into the ones the cache already answers and the ones to ask. */
export function partitionCachedKeys(keys, lookup) {
  const known = {};
  const missing = [];
  for (const k of keys) {
    const v = lookup(k);
    if (typeof v === "string") known[k] = v;
    else missing.push(k);
  }
  return { known, missing };
}

/**
 * Resolve `missing` in batches. Successful batches are handed to `onBatch`
 * immediately (so they're cached even when a later batch fails); if any
 * batch failed, the returned promise rejects with the first error.
 */
export async function resolveIssueTypesInBatches(missing, fetchBatch, onBatch, batchSize = BATCH) {
  let firstError = null;
  for (let i = 0; i < missing.length; i += batchSize) {
    const chunk = missing.slice(i, i + batchSize);
    try {
      const found = (await fetchBatch(chunk)) || {};
      const resolved = {};
      for (const k of chunk) resolved[k] = typeof found[k] === "string" ? found[k] : "";
      onBatch(resolved);
    } catch (err) {
      if (!firstError) firstError = err;
    }
  }
  if (firstError) throw firstError;
}

export function useJiraIssueTypes(mrs) {
  const { isConnected } = useIntegrations();
  const connected = isConnected("jira");
  const swrConfig = useSWRConfig();
  const { mutate } = swrConfig;

  const { keys, beyondCap } = useMemo(() => {
    if (!Array.isArray(mrs)) return { keys: [], beyondCap: 0 };
    const ordered = [...mrs].sort(
      (a, b) => new Date(b?.merged_at || 0).getTime() - new Date(a?.merged_at || 0).getTime(),
    );
    const all = [];
    const seen = new Set();
    for (const m of ordered) {
      for (const k of mrJiraKeys(m)) {
        if (seen.has(k)) continue;
        seen.add(k);
        all.push(k);
      }
    }
    return { keys: all.slice(0, CAP), beyondCap: Math.max(0, all.length - CAP) };
  }, [mrs]);

  const key = connected && keys.length > 0 ? `jira:issue-types:${[...keys].sort().join(",")}` : null;

  const swr = useSwrIf(
    Boolean(key),
    key,
    async () => {
      const { known, missing } = partitionCachedKeys(keys, (k) => readCachedItem(swrConfig, issueTypeKey(k)));
      const out = { ...known };
      await resolveIssueTypesInBatches(
        missing,
        (chunk) => jiraApi.issueTypesForKeys(chunk),
        (resolved) => {
          for (const [k, v] of Object.entries(resolved)) {
            out[k] = v;
            writeCachedItem(mutate, issueTypeKey(k), v);
          }
        },
      );
      return out;
    },
    {
      revalidateIfStale: false,
      // A failed batch is an error, not a partial success — retry it a
      // couple of times, spaced out, instead of freezing "unresolved".
      shouldRetryOnError: true,
      errorRetryCount: 2,
      errorRetryInterval: 60_000,
    },
  );

  // Read through the per-key cache so batches that DID succeed show even
  // while the SWR entry holds an error for a failed one.
  const types = useMemo(() => {
    if (!key) return null;
    const out = { ...(swr.data || {}) };
    for (const k of keys) {
      if (out[k] !== undefined) continue;
      const v = readCachedItem(swrConfig, issueTypeKey(k));
      if (typeof v === "string") out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, keys, swr.data, swr.error, swrConfig]);

  const data = useMemo(() => {
    if (!Array.isArray(mrs)) return mrs;
    if (!types) return mrs;
    return mrs.map((m) => {
      const own = {};
      for (const k of mrJiraKeys(m)) if (types[k]) own[k] = types[k];
      return Object.keys(own).length > 0 ? { ...m, jira_issue_types: own } : m;
    });
  }, [mrs, types]);

  return {
    data,
    isLoading: Boolean(key) && swr.isLoading,
    error: swr.error || null,
    beyondCap,
    connected,
    fetchedAt: swr.fetchedAt ?? null,
  };
}

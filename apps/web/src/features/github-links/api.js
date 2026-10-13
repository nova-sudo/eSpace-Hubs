"use client";

/**
 * Data layer for GitHub issue links — SWR reads over /api/v1/github-links
 * plus the mutations. No UI. Mirrors assigned-goals/api.js.
 *
 * Every key starts with BASE so `revalidateGithubLinks` can sweep them all
 * after a mutation, the same way assigned-goals does.
 */

import { useMemo } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { apiDelete, apiGet, apiPost } from "@/lib/api-client";
import { allSyncedWithin } from "./link-model";

const BASE = "/github-links";

/** Don't re-read GitHub for a goal whose links were all synced this recently. */
export const SYNC_THROTTLE_MS = 15 * 60_000;

/**
 * Last-known links per goal, filled by every read and mutation. Lets the
 * sync throttle (a plain async function, no hook) see what the chips see
 * without threading the list through every caller.
 */
const linksByGoal = new Map();

function remember(goalId, links) {
  if (typeof goalId === "string" && Array.isArray(links)) linksByGoal.set(goalId, links);
}

function toError(r, fallback) {
  const err = new Error(r.error?.message || fallback);
  err.code = r.error?.code;
  err.status = r.status;
  err.details = r.error?.details;
  if (r.error?.retryAfterMs != null) err.retryAfterMs = r.error.retryAfterMs;
  return err;
}

async function fetcher(path) {
  const r = await apiGet(path);
  if (!r.ok) throw toError(r, "Couldn't load GitHub links.");
  return r.data;
}

const OPTS = { revalidateOnFocus: true, shouldRetryOnError: false };

/** Links for one goal. Null key (no request) without a goalId. */
export function useGithubLinks(goalId) {
  const key = goalId ? `${BASE}?goalId=${encodeURIComponent(goalId)}` : null;
  const { data, error, isLoading, mutate } = useSWR(key, fetcher, OPTS);
  const links = useMemo(() => {
    const list = Array.isArray(data?.links) ? data.links : [];
    remember(goalId, list);
    return list;
  }, [data, goalId]);
  return { links, isLoading, error, refresh: mutate };
}

/**
 * Links for many goals at once (a grid / board). One key per sorted, unique
 * id list; results held for a minute so sibling tiles share one request.
 */
export function useGithubLinkManifests(goalIds) {
  const ids = useMemo(() => {
    const uniq = new Set(
      (Array.isArray(goalIds) ? goalIds : []).filter((id) => typeof id === "string" && id),
    );
    return [...uniq].sort();
  }, [goalIds]);
  const key = ids.length ? `${BASE}/manifests?goalIds=${encodeURIComponent(ids.join(","))}` : null;
  const { data, error, isLoading } = useSWR(key, fetcher, {
    ...OPTS,
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });
  const byGoal = useMemo(() => {
    const map = data?.byGoal && typeof data.byGoal === "object" ? data.byGoal : {};
    for (const id of Object.keys(map)) remember(id, map[id]);
    return map;
  }, [data]);
  return { byGoal, isLoading, error };
}

/**
 * Every live link of the signed-in user, across goals (GET /github-links
 * without goalId, ≤ 500). For surfaces that list across goals — the
 * evidence page's "Linked on GitHub".
 */
export function useAllMyGithubLinks({ enabled = true } = {}) {
  const { data, error, isLoading } = useSWR(enabled ? BASE : null, fetcher, {
    ...OPTS,
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });
  const links = useMemo(() => (Array.isArray(data?.links) ? data.links : []), [data]);
  return { links, isLoading, error };
}

const REPORT_KEY_RE = /^\/manager\/reports\/[^/]+\/github-(links|correlation)/;

/**
 * A direct report's links (manager hub) — one goal, or every goal when
 * `goalId` is omitted. Null key without a userId.
 */
export function useReportGithubLinks(userId, goalId) {
  const key = userId
    ? `/manager/reports/${encodeURIComponent(userId)}/github-links${
        goalId ? `?goalId=${encodeURIComponent(goalId)}` : ""
      }`
    : null;
  const { data, error, isLoading, mutate } = useSWR(key, fetcher, OPTS);
  const links = useMemo(() => (Array.isArray(data?.links) ? data.links : []), [data]);
  return { links, isLoading, error, refresh: mutate };
}

/**
 * The correlation report (GET /github-links/correlation): per goal with a
 * live link, every period with its issue, linked PRs, newest reading,
 * grade and gap flags. One goal, or all of them without `goalId`.
 */
export function useGithubCorrelation(goalId, { enabled = true } = {}) {
  const key = enabled
    ? `${BASE}/correlation${goalId ? `?goalId=${encodeURIComponent(goalId)}` : ""}`
    : null;
  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    ...OPTS,
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });
  const goals = useMemo(() => (Array.isArray(data?.goals) ? data.goals : []), [data]);
  return { goals, data, isLoading, error, refresh: mutate };
}

/** The same report for a direct report (manager hub). Null key without a userId. */
export function useReportGithubCorrelation(userId, goalId) {
  const key = userId
    ? `/manager/reports/${encodeURIComponent(userId)}/github-correlation${
        goalId ? `?goalId=${encodeURIComponent(goalId)}` : ""
      }`
    : null;
  const { data, error, isLoading, mutate } = useSWR(key, fetcher, OPTS);
  const goals = useMemo(() => (Array.isArray(data?.goals) ? data.goals : []), [data]);
  return { goals, data, isLoading, error, refresh: mutate };
}

/** The mirrored developer replies + eSpace's posts for one link. */
export function useGithubLinkComments(linkId) {
  const key = linkId ? `${BASE}/${encodeURIComponent(linkId)}/comments` : null;
  const { data, error, isLoading, mutate } = useSWR(key, fetcher, OPTS);
  return {
    comments: Array.isArray(data?.comments) ? data.comments : [],
    posts: Array.isArray(data?.posts) ? data.posts : [],
    isLoading,
    error,
    refresh: mutate,
  };
}

/** Revalidate every github-links key (per-goal reads, manifests, report reads). */
export function revalidateGithubLinks() {
  return globalMutate(
    (key) => typeof key === "string" && (key.startsWith(BASE) || REPORT_KEY_RE.test(key)),
  );
}

function unwrap(r, fallback) {
  if (r.ok) return r.data;
  throw toError(r, fallback);
}

/**
 * Create issues for a tracker's periods. Resolves to the API's
 * `{ links, created, adopted, skipped, remaining, retryAfterMs? }`; rejects
 * with `err.code` from the API envelope (see publishErrorCopy).
 */
export async function publishToGithub({ goalId, repo, periodIndexes }) {
  const body = { goalId, repo: String(repo || "").trim() };
  if (Array.isArray(periodIndexes)) body.periodIndexes = periodIndexes;
  const data = unwrap(await apiPost(`${BASE}/publish`, body), "Couldn't publish to GitHub.");
  remember(goalId, data?.links);
  void revalidateGithubLinks();
  return data;
}

/**
 * Re-read a goal's issues from GitHub. Skips the request (resolves to
 * `{ skipped: true, links }`) when every link was synced within the last 15
 * minutes, unless `force` is set — the scheduler already reads hourly, so a
 * casual click shouldn't spend the user's rate limit.
 */
export async function syncGithubLinks(goalId, { force = false } = {}) {
  const known = linksByGoal.get(goalId);
  if (!force && Array.isArray(known) && allSyncedWithin(known, SYNC_THROTTLE_MS)) {
    return { skipped: true, links: known, readingsWritten: 0, errors: {} };
  }
  const data = unwrap(await apiPost(`${BASE}/sync`, { goalId }), "Couldn't sync with GitHub.");
  remember(goalId, data?.links);
  void revalidateGithubLinks();
  return data;
}

/** Forget a link (the issue stays on GitHub). */
export async function unlinkGithub(linkId) {
  const data = unwrap(
    await apiDelete(`${BASE}/${encodeURIComponent(linkId)}`),
    "Couldn't unlink the issue.",
  );
  void revalidateGithubLinks();
  return data;
}

/** Create the issue again for a link whose issue went missing. */
export async function republishGithub(linkId) {
  const data = unwrap(
    await apiPost(`${BASE}/${encodeURIComponent(linkId)}/republish`, {}),
    "Couldn't republish the issue.",
  );
  void revalidateGithubLinks();
  return data?.link ?? null;
}

/**
 * Post a shared 1:1 note (`manager_note`) or a tier verdict
 * (`tier_verdict`) on a report's linked issue. The server composes the
 * text from `sourceId` and posts with the CALLER's GitHub token.
 * Idempotent: resolves `{ post, existing }`; rejects with `err.code`
 * (integration_not_connected · note_private · not_found · rate_limited …).
 */
export async function postIssueComment(linkId, { kind, sourceId }) {
  const data = unwrap(
    await apiPost(`${BASE}/${encodeURIComponent(linkId)}/comments`, { kind, sourceId }),
    "Couldn't post to GitHub.",
  );
  void revalidateGithubLinks();
  return data;
}

"use client";

import useSWR from "swr";
import { apiGet } from "@/lib/api-client";

/**
 * Per-user engagement-config hook.
 *
 * Fetches `/api/v1/auth/me/engagement-config` once (SWR-cached) and
 * returns the public integration URLs + GitHub client id bound to
 * the current user's engagement. Replaces the build-time
 * `NEXT_PUBLIC_*` env reads (`NEXT_PUBLIC_JIRA_URL`,
 * `NEXT_PUBLIC_GITHUB_CLIENT_ID`, `NEXT_PUBLIC_GITLAB_URL`, etc.)
 * with a runtime per-user lookup, so a Crealogix user sees Crealogix
 * URLs and an eSpace user sees eSpace URLs.
 *
 * Returns:
 *   config: {
 *     engagement: "espace" | "crealogix",
 *     githubClientId: string | null,
 *     githubOrg:      string | null,
 *     jiraBaseUrl:    string | null,
 *     jiraProjectKey: string | null,
 *     gitlabBaseUrl:  string | null,
 *     jenkinsBaseUrl: string | null,
 *   } | null
 *   isLoading: boolean
 *   error:     ApiError | null
 *
 * The endpoint is auth-gated — `useSession` returning `user === null`
 * implies this hook will 401 too. Components that depend on the
 * config should gate on `useSession().user` first; otherwise the hook
 * just returns `null` config and the caller's fallback (env-var
 * default, hard-coded placeholder, "—") shows.
 *
 * Cache key is the route path; SWR dedups so multiple components
 * sharing this hook fire ONE network round-trip per render cycle.
 */
const SWR_KEY = "/auth/me/engagement-config";

async function fetcher() {
  const r = await apiGet(SWR_KEY);
  if (!r.ok) {
    // 401 unauthenticated → just return null config without throwing.
    // The caller renders its fallback; throwing here would put SWR
    // into error state every time the user lands logged-out (which
    // is the normal landing for `/login`).
    if (r.error?.code === "unauthenticated") return { config: null };
    throw new Error(r.error?.message || "Couldn't load engagement config");
  }
  return r.data;
}

export function useMyEngagementConfig() {
  const { data, error, isLoading } = useSWR(SWR_KEY, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    dedupingInterval: 60_000,
  });
  return {
    config: data?.config ?? null,
    isLoading: !!isLoading,
    error: error ?? null,
  };
}

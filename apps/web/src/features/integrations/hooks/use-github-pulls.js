"use client";

import { githubApi } from "../api-clients";
import { useIntegrations } from "../use-integrations";
import { useSwrIf } from "./use-swr-if";

export function useGithubOpenPulls() {
  const { isConnected } = useIntegrations();
  return useSwrIf(
    isConnected("github"),
    "github:my-pulls",
    () => githubApi.myOpenPulls(),
  );
}

export function useGithubReviewRequests() {
  const { isConnected } = useIntegrations();
  return useSwrIf(
    isConnected("github"),
    "github:review-requests",
    () => githubApi.reviewRequests(),
  );
}

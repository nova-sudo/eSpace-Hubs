"use client";

import { gitlabApi } from "../api-clients";
import { useIntegrations } from "../use-integrations";
import { useSwrIf } from "./use-swr-if";

export function useGitlabOpenMRs() {
  const { isConnected } = useIntegrations();
  return useSwrIf(isConnected("gitlab"), "gitlab:open-mine", () =>
    gitlabApi.myOpenMRs(),
  );
}

export function useGitlabReviewRequests() {
  const { isConnected } = useIntegrations();
  return useSwrIf(isConnected("gitlab"), "gitlab:review-requests", () =>
    gitlabApi.reviewRequests(),
  );
}

"use client";

import { useMemo } from "react";
import { jiraApi } from "../api-clients";
import { useIntegrations } from "../use-integrations";
import { useSwrIf } from "./use-swr-if";
import { buildDemoTickets, useDemoMode } from "@/features/demo-mode";

export function useJiraTickets() {
  const { isConnected } = useIntegrations();
  const demo = useDemoMode();
  const demoData = useMemo(() => (demo ? buildDemoTickets() : null), [demo]);
  // Always call SWR — demo short-circuit happens at return time, not by
  // skipping the hook (rules of hooks).
  const swr = useSwrIf(
    !demo && isConnected("jira"),
    "jira:my-issues",
    () => jiraApi.myIssues(),
  );
  if (demo) {
    return { data: demoData, isLoading: false, error: null };
  }
  return swr;
}

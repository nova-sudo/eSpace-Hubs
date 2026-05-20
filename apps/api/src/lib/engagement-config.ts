/**
 * Engagement → integration-config resolver.
 *
 * Each engagement (today: "espace" | "crealogix") maps to a set of
 * environment variables under a single uppercase prefix. The
 * resolver looks them up by prefix so adding a new engagement is one
 * env-var block + one entry in `ALL_ENGAGEMENTS` — no changes here.
 *
 *   espace      → ESPACE_GITHUB_CLIENT_ID, ESPACE_JIRA_URL, …
 *   crealogix   → CREALOGIX_GITHUB_CLIENT_ID, CREALOGIX_JIRA_URL, …
 *
 * Values fall through to `undefined` when not set in the env. The
 * `/me/engagement-config` route returns only the non-secret subset
 * (URLs + public client ids) to the web app. Secret fields
 * (GITHUB_CLIENT_SECRET, JENKINS_API_TOKEN) stay server-side; the
 * OAuth exchange endpoint pulls them straight from this resolver.
 */

import type { Engagement } from "../db/types.js";

export interface EngagementConfig {
  // Public / non-secret — safe to ship to the browser.
  githubClientId: string | undefined;
  githubOrg: string | undefined;
  jiraBaseUrl: string | undefined;
  jiraProjectKey: string | undefined;
  gitlabBaseUrl: string | undefined;
  jenkinsBaseUrl: string | undefined;

  // Server-side only — NEVER returned by the public /me endpoint.
  githubClientSecret: string | undefined;
  jenkinsUser: string | undefined;
  jenkinsApiToken: string | undefined;
}

/**
 * Subset of the config that is safe to expose to the browser. Used by
 * the `/api/v1/me/engagement-config` route response. Anything that
 * isn't in this shape stays behind the API.
 */
export interface PublicEngagementConfig {
  engagement: Engagement;
  githubClientId: string | null;
  githubOrg: string | null;
  jiraBaseUrl: string | null;
  jiraProjectKey: string | null;
  gitlabBaseUrl: string | null;
  jenkinsBaseUrl: string | null;
}

export function getEngagementConfig(engagement: Engagement): EngagementConfig {
  const prefix = engagement.toUpperCase();
  return {
    githubClientId: process.env[`${prefix}_GITHUB_CLIENT_ID`],
    githubClientSecret: process.env[`${prefix}_GITHUB_CLIENT_SECRET`],
    githubOrg: process.env[`${prefix}_GITHUB_ORG`],
    jiraBaseUrl: process.env[`${prefix}_JIRA_URL`],
    jiraProjectKey: process.env[`${prefix}_JIRA_PROJECT_KEY`],
    gitlabBaseUrl: process.env[`${prefix}_GITLAB_URL`],
    jenkinsBaseUrl: process.env[`${prefix}_JENKINS_URL`],
    jenkinsUser: process.env[`${prefix}_JENKINS_USER`],
    jenkinsApiToken: process.env[`${prefix}_JENKINS_API_TOKEN`],
  };
}

/**
 * Strip secrets out of the config for the public response. We
 * normalise undefined → null at this boundary because the web hook
 * + UI render `null` as "not configured" cleanly; mixing
 * undefined+null in JSON serialisation produces inconsistent output.
 */
export function toPublicEngagementConfig(
  engagement: Engagement,
  cfg: EngagementConfig,
): PublicEngagementConfig {
  return {
    engagement,
    githubClientId: cfg.githubClientId ?? null,
    githubOrg: cfg.githubOrg ?? null,
    jiraBaseUrl: cfg.jiraBaseUrl ?? null,
    jiraProjectKey: cfg.jiraProjectKey ?? null,
    gitlabBaseUrl: cfg.gitlabBaseUrl ?? null,
    jenkinsBaseUrl: cfg.jenkinsBaseUrl ?? null,
  };
}

import { proxyFetch } from "./proxy-fetch";
import { readIntegrations } from "../integrations-store";

export const gitlabApi = {
  me: () => proxyFetch("gitlab", "user"),

  myOpenMRs: () =>
    proxyFetch("gitlab", "merge_requests?scope=created_by_me&state=opened&per_page=50"),

  /** MRs awaiting the current user's review — requires a known username. */
  reviewRequests: () => {
    const username = readIntegrations().gitlab?.username;
    if (!username) {
      throw new Error("GitLab username unknown — reconnect to populate it");
    }
    return proxyFetch(
      "gitlab",
      `merge_requests?reviewer_username=${encodeURIComponent(username)}&state=opened&per_page=50`,
    );
  },

  /** MRs I authored that merged since a given ISO date. */
  myMergedSince: (isoDate) =>
    proxyFetch(
      "gitlab",
      `merge_requests?scope=created_by_me&state=merged&updated_after=${encodeURIComponent(isoDate)}&per_page=100`,
    ),

  /** Current user's activity events since a date (yyyy-mm-dd). */
  myEventsSince: (isoDate) =>
    proxyFetch(
      "gitlab",
      `events?after=${encodeURIComponent(isoDate.slice(0, 10))}&per_page=100`,
    ),
};

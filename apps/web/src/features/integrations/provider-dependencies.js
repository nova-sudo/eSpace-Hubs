import { PROVIDERS } from "./providers";

export const DASHBOARD_PROVIDER_DEPENDENCIES = Object.freeze({
  tickets: {
    id: "tickets",
    label: "Tickets on your plate",
    providers: ["jira"],
    requirement: "all",
    emptyMessage: "No Jira tickets in this window.",
  },
  merged: {
    id: "merged",
    label: "Merged PRs",
    providers: ["gitlab", "github"],
    requirement: "any",
    emptyMessage: "No merged PRs in this window.",
  },
  reviewTiming: {
    id: "reviewTiming",
    label: "Review timing",
    providers: ["gitlab", "github"],
    requirement: "any",
    emptyMessage: "No reviewed PRs in this window.",
  },
  openPrs: {
    id: "openPrs",
    label: "Open PRs",
    providers: ["gitlab", "github"],
    requirement: "any",
    emptyMessage: "No open PRs need attention.",
  },
  linkage: {
    id: "linkage",
    label: "Jira linkage",
    providers: ["gitlab", "github"],
    requirement: "any",
    emptyMessage: "No merged PRs to inspect for Jira links.",
  },
  snapshots: {
    id: "snapshots",
    label: "Snapshots",
    providers: [],
    requirement: "local",
    emptyMessage: "No snapshots captured yet.",
  },
  reviews: {
    id: "reviews",
    label: "Reviews given",
    providers: ["gitlab", "github"],
    requirement: "any",
    emptyMessage: "No MR comments in this period.",
  },
});

export function getDashboardProviderDependency(tileId) {
  return DASHBOARD_PROVIDER_DEPENDENCIES[tileId] ?? null;
}

export function providerLabel(providerId) {
  return PROVIDERS[providerId]?.label ?? providerId;
}

export function providerListLabel(providerIds = []) {
  const labels = providerIds.map(providerLabel).filter(Boolean);
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} or ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, or ${labels[labels.length - 1]}`;
}

export function dependencyIsSatisfied(dependency, integrations = {}) {
  if (!dependency) return true;
  if (dependency.requirement === "local") return true;
  const connected = dependency.providers.filter(
    (providerId) => integrations[providerId]?.connected,
  );
  if (dependency.requirement === "all") {
    return connected.length === dependency.providers.length;
  }
  return connected.length > 0;
}

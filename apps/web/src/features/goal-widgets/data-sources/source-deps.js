/**
 * Narrow re-export module that gives `use-data-source.js` one place to
 * pick up every integration hook + pure metric function it needs. Keeps
 * the real `@/features/integrations` barrel intact (its feature code
 * imports from there) and lets the data-source layer evolve without
 * polluting integration internals.
 *
 * Do NOT import from `@/features/integrations` directly inside widgets.
 * Widgets should only ever touch `useDataSource()`.
 */

export {
  useCombinedMergedSince,
  useGitlabMergedSince,
  useGithubMergedSince,
  useJiraTickets,
  avgReviewerComments,
  linkagePct,
  medianTurnaroundDays,
  mergedWithin,
  mergedTrend,
  turnaroundHistogram,
} from "@/features/integrations";

export { SOURCE_METRICS } from "@/features/goal-specs";

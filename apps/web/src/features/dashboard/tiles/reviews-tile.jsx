"use client";

import { BentoTile } from "@/components/ui";
import {
  getDashboardProviderDependency,
  ProviderStateCallout,
  useCombinedEventsSince,
  useIntegrations,
} from "@/features/integrations";
import { useHubLink } from "@/features/hubs";
import { useDateRange, splitByRange } from "../date-range";

const REVIEWS_DEPENDENCY = getDashboardProviderDependency("reviews");
const CODE_HOSTS = REVIEWS_DEPENDENCY.providers;

/**
 * Reviews given — "where you showed up". One row per distinct MR target the
 * user commented on in the window, sorted by comment count (accent),
 * truncated to the top 5 + overflow row.
 *
 * Design (section 04, col span 3 × row span 2):
 *   REVIEWS GIVEN
 *   repo/service         14   ← count is accent mono bold
 *   repo/web              7
 *   …
 *   + 3 others           12
 */
export function ReviewsTile() {
  const { range } = useDateRange();
  const { isConnected } = useIntegrations();
  const link = useHubLink();
  const { data, isLoading, error } = useCombinedEventsSince(range.fetchSince);
  const { current } = splitByRange(data || [], range, (e) => e.created_at);
  const hasCodeHost = CODE_HOSTS.some((id) => isConnected(id));

  const byBucket = groupReviewTargets(current);
  const top = byBucket.slice(0, 5);
  const rest = byBucket.slice(5);
  const othersCount = rest.reduce((sum, r) => sum + r.count, 0);
  const totalGiven = byBucket.reduce((s, r) => s + r.count, 0);

  return (
    <BentoTile
      // Lives in row 1 of the trend section alongside Heatmap (col 6) and
      // the new compact Turnaround (col 3). Activity (line chart) sits
      // full-width in row 2 below.
      col="span 3"
      row="span 1"
      usedInEvidence
      label={`Reviews given · ${range.label.toLowerCase()}`}
      right={
        <span
          className="text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
        >
          {totalGiven} total
        </span>
      }
    >
      {!hasCodeHost ? (
        <ProviderStateCallout
          kind="disconnected"
          providers={CODE_HOSTS}
          message="Connect GitLab or GitHub to track your review activity."
          actionHref={link("/settings")}
          actionLabel="Connect source"
        />
      ) : isLoading ? (
        <div className="text-[12px] text-muted-fg">Loading…</div>
      ) : error ? (
        <ProviderStateCallout
          kind="error"
          providers={CODE_HOSTS}
          message="Couldn't load review activity."
          actionHref={link("/settings")}
          actionLabel="Review setup"
        />
      ) : byBucket.length === 0 ? (
        <div className="text-[12px] text-muted-fg">
          No MR comments in this period.
        </div>
      ) : (
        <div className="mt-1.5 flex flex-col">
          {top.map((row) => (
            <ReviewRow key={row.key} name={row.key} count={row.count} />
          ))}
          {rest.length > 0 ? (
            <ReviewRow
              name={`+ ${rest.length} others`}
              count={othersCount}
              muted
            />
          ) : null}
        </div>
      )}
    </BentoTile>
  );
}

function ReviewRow({ name, count, muted }) {
  return (
    <div
      className="flex items-center justify-between border-b border-border py-2 last:border-b-0"
      style={{ borderStyle: "solid" }}
    >
      <span
        className={muted ? "text-muted-fg" : ""}
        style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
      >
        {name}
      </span>
      <span
        className="font-bold text-accent"
        style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
      >
        {count}
      </span>
    </div>
  );
}

// Group MR-comment events into a { key, count } list. Key is best-available
// per-MR identifier — `target_title` when provided by the feed, otherwise a
// repo fallback.
function groupReviewTargets(events) {
  const counts = new Map();
  for (const e of events) {
    if (
      !(e.action_name === "commented on" || e.action_name === "commented") ||
      e.target_type !== "MergeRequest"
    ) {
      continue;
    }
    // Best key order: MR title → repo name → project id → "other".
    const key =
      e.target_title ||
      e.repo_name ||
      (e.project_id ? `project/${e.project_id}` : null) ||
      "other";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts, ([key, count]) => ({ key, count })).sort(
    (a, b) => b.count - a.count,
  );
}

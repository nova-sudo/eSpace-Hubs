"use client";

import { BentoTile } from "@/components/ui";
import {
  useCombinedEventsSince,
} from "@/features/integrations";
import { useDateRange, splitByRange } from "../date-range";

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
  const { data, isLoading, error } = useCombinedEventsSince(range.fetchSince);
  const { current } = splitByRange(data || [], range, (e) => e.created_at);

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
      {error ? (
        <div className="text-[12px] text-muted-fg">—</div>
      ) : isLoading ? (
        <div className="text-[12px] text-muted-fg">Loading…</div>
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

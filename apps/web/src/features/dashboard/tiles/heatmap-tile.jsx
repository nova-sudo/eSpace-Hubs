"use client";

import { BentoTile, ContributionHeatmap } from "@/components/ui";
import { useCombinedEventsSince } from "@/features/integrations";
import { useDateRange } from "../date-range";

/**
 * Contribution heatmap (GitHub-style), wired to the dashboard's date
 * range toolbar.
 *
 * Width adapts to the selected preset:
 *   - Week    → 1 column
 *   - 30D     → 5 columns
 *   - Month   → ~5 columns
 *   - 90D     → 13 columns
 *   - Quarter → ~13 columns
 *   - Year    → 53 columns (the full GitHub layout)
 *
 * The heatmap shares its data fetch with `useCombinedEventsSince` —
 * SWR dedupes between this tile and the line-chart Activity tile when
 * they happen to ask for the same window. Same key, one network call.
 */
export function HeatmapTile() {
  const { range } = useDateRange();
  const { data: events, isLoading } = useCombinedEventsSince(range.fetchSince);
  const total = (events && events.length) || 0;
  const peak = computePeak(events || []);

  const labelBase = `Activity heatmap · ${range.label.toLowerCase()}`;

  return (
    <BentoTile
      // Sits in the left column above the line chart. Half-width by
      // design — the heatmap's natural width fits a 6-col cell with
      // the SVG's viewBox auto-scaling on narrower viewports.
      col="span 6"
      row="span 1"
      label={
        isLoading
          ? `${labelBase} · loading…`
          : `${labelBase} · ${total} events · peak ${peak}/day`
      }
      title="Where the work happened"
      titleSize={16}
    >
      <div className="flex h-full flex-col justify-center">
        <ContributionHeatmap events={events || []} days={range.days} />
      </div>
    </BentoTile>
  );
}

/**
 * Peak events on any single day in the window. Used in the tile label
 * so the user has a sense of scale without needing to read every cell.
 */
function computePeak(events) {
  const byDay = new Map();
  for (const e of events) {
    const day = (e?.created_at || "").slice(0, 10);
    if (!day) continue;
    byDay.set(day, (byDay.get(day) || 0) + 1);
  }
  let max = 0;
  for (const v of byDay.values()) if (v > max) max = v;
  return max;
}

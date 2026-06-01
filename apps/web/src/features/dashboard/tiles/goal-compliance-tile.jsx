"use client";

import Link from "next/link";
import { BentoTile } from "@/components/ui";
import { useComplianceSummary } from "@/features/snapshots";
import { useHubLink } from "@/features/hubs";

/**
 * Overview glance-grid tile: how many tracked goals are currently on
 * pace, rolled up from the snapshot compliance stream. Replaces the old
 * Integrations status card (connection state already lives in the header
 * + Settings).
 */
export function GoalComplianceTile() {
  const { met, assessable, pct } = useComplianceSummary();
  const link = useHubLink();
  const hasData = assessable > 0;

  return (
    <BentoTile
      col="span 3"
      row="span 2"
      label={`Goal compliance${hasData ? ` · ${assessable} tracked` : ""}`}
      right={
        <Link
          href={link("/goals")}
          className="text-[10px] uppercase tracking-[0.4px] text-muted-fg hover:text-fg"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          View goals ↗
        </Link>
      }
    >
      {!hasData ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
          <div className="text-[13px] font-semibold text-fg">
            No closed windows yet
          </div>
          <div className="max-w-[200px] text-[11px] leading-[1.45] text-muted-fg">
            Weekly snapshots build your goal-compliance read — check back
            after the first capture.
          </div>
        </div>
      ) : (
        <div className="mt-1 flex h-full flex-col justify-center gap-3">
          <div className="flex items-baseline gap-2">
            <span
              className="font-bold text-fg"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 32,
                lineHeight: 1,
              }}
            >
              {met}/{assessable}
            </span>
            <span
              className="uppercase tracking-[0.4px] text-muted-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
            >
              goals on pace
            </span>
          </div>
          <div>
            <div
              className="mb-1 flex items-center justify-between uppercase tracking-[0.4px] text-muted-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
            >
              <span>On target</span>
              <span className="font-bold text-accent">{pct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-card-alt">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${pct ?? 0}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </BentoTile>
  );
}

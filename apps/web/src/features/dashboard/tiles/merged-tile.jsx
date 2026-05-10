"use client";

import { BentoTile, Delta, DitherField, LineSpark } from "@/components/ui";
import {
  compareCount,
  mergedTrend,
  useCombinedMergedSince,
} from "@/features/integrations";
import { useDateRange, splitByRange } from "../date-range";

export function MergedTile() {
  const { range } = useDateRange();
  const { data, isLoading, error } = useCombinedMergedSince(range.fetchSince);
  const mrs = data || [];
  const { current, previous } = splitByRange(mrs, range, (m) => m.merged_at);
  const cmp = compareCount(current, previous);

  // Fixed 8-week sparkline regardless of preset — gives context beyond range.
  const trend = mergedTrend(mrs, 8).map((b) => b.n);
  const trendSum = trend.reduce((a, b) => a + b, 0);
  const nonZeroWeeks = trend.filter((v) => v > 0).length;
  const showSparkline = trend.length >= 2 && trendSum > 0 && nonZeroWeeks >= 2;

  return (
    <BentoTile
      col="span 4"
      row="span 2"
      variant="accent"
      label={`Merged · ${range.label.toLowerCase()}`}
      right={
        <span
          className="text-[rgba(255,255,255,0.8)]"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
        >
          vs. previous
        </span>
      }
    >
      <div
        className="pointer-events-none absolute -right-5 -top-2.5 opacity-35"
        style={{ zIndex: 0 }}
      >
        <DitherField
          width={220}
          height={220}
          cell={7}
          color="#ffffff"
          falloff={(u, v) =>
            Math.max(0, 1 - Math.sqrt((u - 0.3) ** 2 + (v - 0.6) ** 2) * 1.5)
          }
          jitter={0.4}
          seed={9}
        />
      </div>
      <div className="relative z-[1] flex h-full flex-col justify-between">
        <div className="mt-1 flex items-baseline gap-3.5">
          <div
            className="font-semibold"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 96,
              lineHeight: 0.9,
              letterSpacing: "-4px",
            }}
          >
            {error ? "!" : isLoading ? "…" : cmp.current}
          </div>
          <div
            className="text-[rgba(255,255,255,0.85)]"
            style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
          >
            {/* Mono-styled delta to match other Overview tiles. We render
                inline white text instead of importing <Delta> because its
                colour scheme is built for the light-tile palette and would
                look broken on the white-on-blue accent fill. */}
            <div className="flex items-center gap-1.5">
              <span
                className="font-bold"
                style={{
                  color: cmp.delta > 0 ? "#a8ffd1" : cmp.delta < 0 ? "#ffd2cf" : "rgba(255,255,255,0.85)",
                }}
              >
                {cmp.delta > 0 ? "↑" : cmp.delta < 0 ? "↓" : "·"}{" "}
                {Math.abs(cmp.delta)}
              </span>
              <span className="opacity-70">vs. previous</span>
            </div>
            <div className="opacity-80">Prior: {cmp.previous}</div>
          </div>
        </div>
        <div>
          {showSparkline ? (
            <>
              <LineSpark
                data={trend}
                color="#ffffff"
                height={40}
                strokeWidth={2}
                fillOpacity={0.22}
                showDots
              />
              <div
                className="mt-1 flex justify-between text-[rgba(255,255,255,0.6)]"
                style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}
              >
                <span>8w ago</span>
                <span>this week</span>
              </div>
            </>
          ) : (
            <div
              className="text-[rgba(255,255,255,0.65)]"
              style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
            >
              Trend builds after 2+ weeks of merges.
            </div>
          )}
        </div>
      </div>
    </BentoTile>
  );
}

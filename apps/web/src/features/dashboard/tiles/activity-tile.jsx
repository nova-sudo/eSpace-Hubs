"use client";

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BentoTile } from "@/components/ui";
import {
  dailyActivity,
  peakPerDay,
  totalEvents,
  useCombinedEventsSince,
} from "@/features/integrations";
import { useDateRange, splitByRange } from "../date-range";

export function ActivityTile() {
  const { range } = useDateRange();
  const { data, isLoading } = useCombinedEventsSince(range.fetchSince);
  const { current } = splitByRange(data || [], range, (e) => e.created_at);
  // Cap at 30 daily bars so the chart stays legible — long ranges collapse.
  const windowDays = Math.min(Math.max(range.days, 7), 30);
  const buckets = dailyActivity(current, windowDays);
  const total = totalEvents(buckets);
  const peak = peakPerDay(buckets);

  return (
    <BentoTile
      // Sits in row 2 of the trend section, full-width below the row-1
      // tiles (Heatmap · Turnaround · Reviews). Wider chart = legible
      // x-axis even on long ranges.
      col="span 12"
      row="span 1"
      label={`Activity · ${range.label.toLowerCase()} · ${total} events · peak ${peak}/day`}
      title="Signal strength"
      titleSize={16}
    >
      <div className="relative flex-1">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-[12px] text-muted-fg">
            Loading…
          </div>
        ) : total === 0 ? (
          <div className="flex h-full items-center justify-center text-[12px] text-muted-fg">
            No activity in this period.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={buckets}
              margin={{ top: 8, right: 4, left: 4, bottom: 4 }}
            >
              <defs>
                <linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.4} />
                  <stop
                    offset="100%"
                    stopColor="var(--accent)"
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="label"
                interval={Math.max(0, Math.floor(buckets.length / 7) - 1)}
                tickLine={false}
                axisLine={false}
                tick={{
                  fontSize: 10,
                  fill: "var(--dim-fg)",
                  fontFamily: "var(--font-mono)",
                }}
              />
              <YAxis hide />
              <Tooltip
                cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border-strong)",
                  borderRadius: 4,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  padding: "6px 10px",
                  color: "var(--fg)",
                }}
                labelStyle={{ color: "var(--muted-fg)" }}
                formatter={(v) => [`${v} event${v === 1 ? "" : "s"}`, ""]}
              />
              <Area
                type="monotone"
                dataKey="n"
                stroke="var(--accent)"
                strokeWidth={2.25}
                fill="url(#activityFill)"
                dot={false}
                activeDot={{ r: 4, fill: "var(--accent)", strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </BentoTile>
  );
}

"use client";

import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

/**
 * Recharts-backed line chart for small inline tile usage.
 *
 * One primitive for every sparkline-scale chart in the app so the rendering
 * stays consistent across tiles. If you need tooltips or axis labels, reach
 * for recharts directly inside the tile — this stays opinionated and small.
 */
export function LineSpark({
  data = [],
  color = "var(--accent)",
  height = 36,
  strokeWidth = 2,
  fillOpacity = 0.25,
  showDots = false,
  className,
}) {
  const id = useId().replace(/:/g, "_");
  const gradId = `line-spark-${id}`;

  const rows = data.map((v, i) => ({ i, n: typeof v === "number" ? v : (v.n ?? 0) }));
  if (rows.length < 2) return null;

  return (
    <div className={className} style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={fillOpacity} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="n"
            stroke={color}
            strokeWidth={strokeWidth}
            fill={`url(#${gradId})`}
            dot={showDots ? { r: 2, fill: color, strokeWidth: 0 } : false}
            activeDot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

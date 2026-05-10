"use client";

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, MonoLabel } from "@/components/ui";

/**
 * Snapshot trend chart — visually matches the "Signal strength" tile on the
 * Performance page (gradient area, monotone curve, no rest-dots, hover
 * tooltip). Selection UX is preserved: clicking the chart or any X-axis
 * label selects that week, and the selected week renders a small dot + ring
 * so it stays visible without hover.
 */
export function TrendChart({
  series,
  metricKey,
  metricLabel,
  unit = "",
  invert = false,
  selected,
  onSelect,
}) {
  if (series.length === 0) return null;

  // A line needs ≥2 points to exist. Render a friendly empty state instead of
  // a degenerate zero-width path in the bottom-left corner.
  if (series.length < 2) {
    const only = series[0];
    return (
      <Card className="mb-9 p-0">
        <div className="flex items-baseline justify-between border-b border-border px-6 py-5">
          <div>
            <MonoLabel>
              {metricLabel} · {series.length} week
            </MonoLabel>
            <div className="mt-1.5 flex items-baseline gap-3">
              <span
                className="font-semibold leading-none"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 44,
                  letterSpacing: "-1.4px",
                }}
              >
                {only[metricKey] ?? "—"}
                {unit}
              </span>
            </div>
          </div>
        </div>
        <div className="flex h-[260px] flex-col items-center justify-center gap-2 px-6 text-center">
          <MonoLabel>Needs more snapshots</MonoLabel>
          <p className="max-w-md text-[13px] leading-[1.5] text-muted-fg">
            Trends need at least two weeks of data. Capture another snapshot next
            Monday and the line will start to build.
          </p>
        </div>
      </Card>
    );
  }

  const values = series.map((s) => s[metricKey] ?? 0);
  const first = values[0];
  const last = values[values.length - 1];
  const delta = last - first;
  const pct = first ? Math.round((delta / first) * 100) : 0;
  const good = invert ? delta < 0 : delta > 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;

  // Unique gradient id per metric so multiple TrendCharts on the same page
  // don't collide on the same <defs> linearGradient.
  const fillId = `snapshot-fill-${metricKey}`;
  const selectedIndex = series.findIndex((s) => s.week === selected);

  const formatValue = (v) => {
    if (v == null) return `—${unit}`;
    const n = metricKey === "rounds" ? Number(v).toFixed(1) : Math.round(v);
    return `${n}${unit}`;
  };

  return (
    <Card className="mb-9 p-0">
      <div className="flex items-baseline justify-between border-b border-border px-6 py-5">
        <div>
          <MonoLabel>
            {metricLabel} · {series.length} weeks
          </MonoLabel>
          <div className="mt-1.5 flex items-baseline gap-3">
            <span
              className="font-semibold leading-none"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 44,
                letterSpacing: "-1.4px",
              }}
            >
              {last}
              {unit}
            </span>
            <span
              className="font-semibold"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: good ? "var(--good)" : "var(--bad)",
              }}
            >
              {delta > 0 ? "↑" : delta < 0 ? "↓" : "·"}{" "}
              {Math.abs(delta).toFixed(metricKey === "rounds" ? 1 : 0)}
              {unit} ({pct >= 0 ? "+" : ""}
              {pct}%)
            </span>
          </div>
        </div>
        <div className="text-right">
          <MonoLabel>{series.length}-week avg</MonoLabel>
          <div
            className="mt-1 font-semibold"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 22,
              letterSpacing: "-0.5px",
            }}
          >
            {avg.toFixed(metricKey === "rounds" ? 1 : 0)}
            {unit}
          </div>
        </div>
      </div>

      <div className="relative h-[260px] px-3 pb-2 pt-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={series}
            margin={{ top: 8, right: 16, left: 16, bottom: 4 }}
            onClick={(state) => {
              if (state?.activeLabel) onSelect(state.activeLabel);
            }}
          >
            <defs>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--accent)"
                  stopOpacity={0.4}
                />
                <stop
                  offset="100%"
                  stopColor="var(--accent)"
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="week"
              interval={0}
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              tick={(props) => {
                const { x, y, payload } = props;
                const isSel = payload.value === selected;
                return (
                  <g transform={`translate(${x},${y})`}>
                    <text
                      x={0}
                      y={0}
                      dy={12}
                      textAnchor="middle"
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        fontWeight: isSel ? 700 : 400,
                        fill: isSel ? "var(--accent)" : "var(--muted-fg)",
                        cursor: "pointer",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(payload.value);
                      }}
                    >
                      {payload.value}
                    </text>
                  </g>
                );
              }}
            />
            <YAxis hide domain={["auto", "auto"]} />
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
              formatter={(v) => [formatValue(v), metricLabel]}
            />
            <Area
              type="monotone"
              dataKey={metricKey}
              stroke="var(--accent)"
              strokeWidth={2.25}
              fill={`url(#${fillId})`}
              dot={(props) => {
                // Recharts calls `dot` for every point. We render a marker
                // ONLY for the currently-selected week — that's how the user
                // sees which week the inspector below is keyed to.
                if (props.index !== selectedIndex) {
                  return <g key={`dot-${props.index}`} />;
                }
                return (
                  <g key={`dot-${props.index}`}>
                    <circle
                      cx={props.cx}
                      cy={props.cy}
                      r={7}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth={1}
                      opacity={0.35}
                    />
                    <circle
                      cx={props.cx}
                      cy={props.cy}
                      r={4}
                      fill="var(--accent)"
                    />
                  </g>
                );
              }}
              activeDot={{ r: 5, fill: "var(--accent)", strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

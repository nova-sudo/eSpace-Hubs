"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Badge, Card, Label } from "@/components/ui";

/**
 * Snapshot trend chart. Selection UX is preserved: clicking the chart or any
 * X-axis label selects that week, and the selected week renders a small dot
 * + ring so it stays visible without hover.
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
      <Card padding={0} className="mb-9">
        <div className="flex items-baseline justify-between border-b border-line px-6 py-5">
          <div>
            <Label>
              {metricLabel} · {series.length} week
            </Label>
            <div className="mt-1.5 flex items-baseline gap-3">
              <span className="text-[44px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg">
                {only[metricKey] ?? "—"}
                {unit}
              </span>
            </div>
          </div>
        </div>
        <div className="flex h-[260px] flex-col items-center justify-center gap-2 px-6 text-center">
          <Label>Needs more snapshots</Label>
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
    <Card padding={0} className="mb-9">
      <div className="flex items-baseline justify-between border-b border-line px-6 py-5">
        <div>
          <Label>
            {metricLabel} · {series.length} weeks
          </Label>
          <div className="mt-1.5 flex items-baseline gap-3">
            <span className="text-[44px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg">
              {last}
              {unit}
            </span>
            {delta !== 0 ? (
              <Badge tone={good ? "mint" : "peach"}>
                {delta > 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                {Math.abs(delta).toFixed(metricKey === "rounds" ? 1 : 0)}
                {unit} ({pct >= 0 ? "+" : ""}
                {pct}%)
              </Badge>
            ) : (
              <span className="text-[12px] font-semibold text-muted-fg">no change</span>
            )}
          </div>
        </div>
        <div className="text-right">
          <Label>{series.length}-week avg</Label>
          <div className="mt-1 text-[22px] font-extrabold tracking-[-0.03em] text-fg">
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
                <stop offset="0%" stopColor="var(--ink)" stopOpacity={0.12} />
                <stop offset="100%" stopColor="var(--ink)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line)" />
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
                        fontSize: 11,
                        fontWeight: isSel ? 700 : 500,
                        fill: isSel ? "var(--fg)" : "var(--muted-fg)",
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
              cursor={{ stroke: "var(--line)", strokeWidth: 1 }}
              contentStyle={{
                background: "var(--card)",
                border: "none",
                borderRadius: "var(--radius-md)",
                boxShadow: "var(--shadow-float)",
                fontSize: 12,
                padding: "6px 10px",
                color: "var(--fg)",
              }}
              labelStyle={{ color: "var(--muted-fg)" }}
              formatter={(v) => [formatValue(v), metricLabel]}
            />
            <Area
              type="monotone"
              dataKey={metricKey}
              stroke="var(--ink)"
              strokeWidth={1.5}
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
                      stroke="var(--ink)"
                      strokeWidth={1}
                      opacity={0.35}
                    />
                    <circle cx={props.cx} cy={props.cy} r={4} fill="var(--ink)" />
                  </g>
                );
              }}
              activeDot={{ r: 5, fill: "var(--ink)", strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

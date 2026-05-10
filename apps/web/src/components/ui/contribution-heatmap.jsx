"use client";

import { useMemo } from "react";

/**
 * GitHub-style contribution heatmap.
 *
 * Pure presentational. Takes a flat array of events with `created_at`
 * timestamps and renders 53 weeks × 7 days of cells, intensity-shaded by
 * each day's event count.
 *
 * SOLID notes:
 *   - The component knows nothing about how events were fetched. Caller
 *     supplies them. Same component can render Jira / GitHub / combined
 *     activity by changing the input array.
 *   - Color buckets are derived from the data's own quantiles (not a
 *     hardcoded threshold). New users with low activity still see a
 *     full intensity range; heavy users don't max out.
 *
 * Sizing matches GitHub's reference layout:
 *   - 11px cell + 3px gap (= 14px stride)
 *   - 53 columns × 7 rows = 371 days (rolling 12-month window)
 *   - Month labels on top, weekday labels on left (Mon/Wed/Fri only —
 *     same as GitHub, so the grid stays readable)
 */
export function ContributionHeatmap({
  events,
  /**
   * Width of the grid in days. Drives the column count: ceil(days / 7),
   * always ending on the Saturday of the current calendar week so the
   * rightmost column is "this week".
   *
   * Defaults to 365 (full GitHub year) when omitted, so existing callers
   * that don't yet pass `days` keep working.
   */
  days = 365,
  variant = "default",
  cellSize = 11,
  cellGap = 3,
  className = "",
}) {
  // Build "yyyy-mm-dd" → count map. Slice on the ISO string keeps us in
  // the user's local-equivalent UTC day; good enough for daily buckets.
  const byDay = useMemo(() => {
    const map = new Map();
    for (const e of events || []) {
      const ts = e?.created_at || "";
      if (typeof ts !== "string" || ts.length < 10) continue;
      const day = ts.slice(0, 10);
      map.set(day, (map.get(day) || 0) + 1);
    }
    return map;
  }, [events]);

  // Number of weeks the grid covers. We always render whole columns —
  // a "30d" window becomes 5 weeks (covering ≥30 days, anchored to
  // Sun-Sat boundaries). Floor 1 for the "this week" preset.
  const numWeeks = Math.max(1, Math.ceil(days / 7));

  // Grid ends on the Saturday of the current week, walks back N weeks.
  const { cells, monthLabels, totalCount, maxDay } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setDate(today.getDate() + (6 - today.getDay()));
    const start = new Date(end);
    start.setDate(end.getDate() - (numWeeks * 7 - 1));

    const cells = [];
    const monthLabels = []; // [{col, label}]
    let prevMonth = -1;
    const day = new Date(start);
    let total = 0;
    let maxV = 0;
    for (let i = 0; i < numWeeks * 7; i++) {
      const dateStr = isoDay(day);
      const count = byDay.get(dateStr) || 0;
      total += count;
      if (count > maxV) maxV = count;
      const col = Math.floor(i / 7);
      const row = i % 7; // 0 = Sun, 6 = Sat
      cells.push({
        col,
        row,
        date: new Date(day),
        dateStr,
        count,
        // Don't render days that haven't happened yet (the right edge
        // can extend past today). We still keep the slot for layout.
        future: day > today,
      });
      // Month label: when the month flips, record the column. Skip on
      // very narrow grids (<= 4 weeks) where labels would crowd out
      // the cells themselves.
      if (numWeeks > 4 && row === 0 && day.getMonth() !== prevMonth) {
        monthLabels.push({ col, label: MONTHS[day.getMonth()] });
        prevMonth = day.getMonth();
      }
      day.setDate(day.getDate() + 1);
    }
    return { cells, monthLabels, totalCount: total, maxDay: maxV };
  }, [byDay, numWeeks]);

  // Pick a single threshold scale based on the heaviest day in the
  // window. Five buckets: 0, low, mid, high, peak — matching GitHub.
  const thresholds = useMemo(() => {
    const m = Math.max(maxDay, 1);
    // Tuned to feel comparable to GitHub at typical activity levels:
    // light = 1 event, medium = ~25%, strong = ~50%, peak = ~75%+ of max.
    return {
      a: 0.01,
      b: m * 0.25,
      c: m * 0.5,
      d: m * 0.75,
    };
  }, [maxDay]);

  const isLight = variant === "light";

  // Color ramp. The 0-count cell is a faint border-only square; the rest
  // ramp up the accent (or a green ramp on the inverse theme so it reads
  // GitHub-like even on indigo).
  const palette = isLight
    ? [
        "rgba(255,255,255,0.10)", // 0
        "rgba(0,196,138,0.35)", // low
        "rgba(0,196,138,0.55)", // mid
        "rgba(0,196,138,0.75)", // high
        "rgba(0,196,138,1)", // peak
      ]
    : [
        "rgba(56,38,255,0.06)", // 0
        "rgba(56,38,255,0.25)", // low
        "rgba(56,38,255,0.5)", // mid
        "rgba(56,38,255,0.78)", // high
        "rgb(56,38,255)", // peak
      ];

  function colorFor(count) {
    if (count <= 0) return palette[0];
    if (count <= thresholds.b) return palette[1];
    if (count <= thresholds.c) return palette[2];
    if (count <= thresholds.d) return palette[3];
    return palette[4];
  }

  const stride = cellSize + cellGap;
  const labelGutter = 22; // weekday labels on the left
  // Hide the month-labels strip on very-narrow grids — the labels would
  // overlap and there are no months to delineate within a single week.
  const headerHeight = numWeeks > 4 ? 14 : 0;
  const gridWidth = numWeeks * stride;
  const gridHeight = 7 * stride;
  const totalWidth = gridWidth + labelGutter;
  const totalHeight = gridHeight + headerHeight;

  const labelColor = isLight ? "rgba(255,255,255,0.55)" : "var(--muted-fg)";
  const dimLabelColor = isLight ? "rgba(255,255,255,0.4)" : "var(--dim-fg)";

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {/* Render the SVG at its NATURAL pixel size, only shrinking when the
          container is narrower. Without this, a small grid (e.g. 5 cols
          for the "30D" preset) gets blown up ~7× because its viewBox is
          tiny while the surrounding tile is wide. `maxWidth: 100%` plus
          intrinsic `width`/`height` attrs keeps the cells at the right
          pixel size on every preset. `preserveAspectRatio="xMinYMid meet"`
          left-aligns the grid when the SVG is forced to scale down on
          narrow tiles instead of stretching to fill. */}
      <svg
        viewBox={`0 0 ${totalWidth} ${totalHeight}`}
        width={totalWidth}
        height={totalHeight}
        preserveAspectRatio="xMinYMid meet"
        style={{ maxWidth: "100%", height: "auto", overflow: "visible" }}
        aria-label={`Contribution heatmap · ${totalCount} events`}
      >
        {/* Month labels — top */}
        {monthLabels.map((m) => (
          <text
            key={`m-${m.col}`}
            x={labelGutter + m.col * stride}
            y={10}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              fill: labelColor,
              letterSpacing: "0.4px",
            }}
          >
            {m.label}
          </text>
        ))}

        {/* Weekday labels — left (Mon, Wed, Fri only, like GitHub) */}
        {[
          { row: 1, label: "Mon" },
          { row: 3, label: "Wed" },
          { row: 5, label: "Fri" },
        ].map(({ row, label }) => (
          <text
            key={`w-${row}`}
            x={0}
            y={headerHeight + row * stride + cellSize - 1}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              fill: dimLabelColor,
              letterSpacing: "0.4px",
            }}
          >
            {label}
          </text>
        ))}

        {/* Cells */}
        <g transform={`translate(${labelGutter}, ${headerHeight})`}>
          {cells.map((c) => (
            <rect
              key={c.dateStr}
              x={c.col * stride}
              y={c.row * stride}
              width={cellSize}
              height={cellSize}
              rx={2}
              fill={c.future ? "transparent" : colorFor(c.count)}
            >
              {/* SVG <title> demands a SINGLE string child — React (and the
                  HTML spec) treats <title> contents as text-only. Mixing a
                  string + a value + a string + a value here produced a
                  5-element children array PER CELL, firing a console
                  warning on every render. With 371 cells × strict-mode
                  doubling, that's ~750 warnings per render — which on its
                  own makes the analyst page visibly laggy. Template-string
                  collapses the children to one string. */}
              <title>
                {`${prettyDate(c.date)} · ${c.count} event${c.count === 1 ? "" : "s"}`}
              </title>
            </rect>
          ))}
        </g>
      </svg>

      {/* Legend — small "Less □ □ □ □ □ More" strip */}
      <div
        className="flex items-center justify-end gap-2"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          color: labelColor,
          letterSpacing: "0.4px",
        }}
      >
        <span>Less</span>
        <div className="flex items-center gap-[3px]">
          {palette.map((c, i) => (
            <span
              key={i}
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: cellSize,
                height: cellSize,
                background: c,
                borderRadius: 2,
              }}
            />
          ))}
        </div>
        <span>More</span>
      </div>
    </div>
  );
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function isoDay(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function prettyDate(d) {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

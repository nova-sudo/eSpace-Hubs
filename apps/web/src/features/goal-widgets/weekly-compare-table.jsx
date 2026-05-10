"use client";

/**
 * Weekly compare-table — one row per AI-classified goal, columns are
 * the last N weekly snapshots in chronological order. Each cell shows
 * the goal's reading for that week, color-coded by met/not-met.
 *
 * Why this view exists
 * ────────────────────
 * The L1 shelves above show "right now" + overall compliance. They
 * answer "where am I?". This table answers "how did I get here?" —
 * each row is a flight log for one goal.
 *
 *   GOAL                  W08 W09 W10 W11 W12 W13 W14 W15 W16 W17 W18
 *   Mentor 3h/week        ✓3  ✓3  ✗2  ✓3  ✓3  ✓3  ✓3  ✓3  ✓3  ✓3  ●3
 *   Tight rounds ≤2       ✓1.8✓1.9✗2.3✓1.7✗2.4✓1.8✓1.6✗2.1✓1.7✓1.8●1.6
 *   Linkage ≥90           ✓92 ✗88 ✓95 ✓93 ✗89 ✓91 ✓94 ✓92 ✓90 ✗87 ●92
 *
 *   ✓ = window met target · ✗ = missed · ● = in progress
 *
 * Cells show the value (number) prefixed with the symbol. Hover the
 * column header to see the week label + capture date. Click a cell to
 * pivot to the snapshots page focused on that week.
 *
 * Goals with no snapshot history yet are still listed but their cells
 * read "—". A goal with target=null (e.g. delegated) doesn't render —
 * "compare" requires a target to be meaningful.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSnapshots } from "@/features/snapshots";

const MAX_COLS = 12;

export function WeeklyCompareTable({ groups }) {
  const { snapshots } = useSnapshots();

  // Recent weeks, oldest-on-the-left so reading flows chronologically.
  const weeks = useMemo(() => {
    if (!Array.isArray(snapshots) || snapshots.length === 0) return [];
    return [...snapshots]
      .filter((s) => s.week)
      .sort((a, b) => a.week.localeCompare(b.week))
      .slice(-MAX_COLS);
  }, [snapshots]);

  // Flatten the L1-grouped items into a single list, keeping their L1
  // label for grouped row rendering.
  const rows = useMemo(() => {
    const out = [];
    for (const g of groups || []) {
      for (const it of g.items || []) {
        const target = it.spec?.manual?.target || it.spec?.source?.target;
        if (!target || target.value == null) continue;
        // Skip delegated — meaningful comparisons need a self-tracked target.
        if (it.spec?.delegated?.delegated) continue;
        out.push({
          goalId: it.goal.id,
          title: it.goal.title || it.spec.title,
          target,
          l1: g.l1,
        });
      }
    }
    return out;
  }, [groups]);

  if (weeks.length === 0 || rows.length === 0) {
    return (
      <div
        className="rounded-[var(--radius-tile)] border border-dashed border-border bg-card-alt px-5 py-6 text-muted-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, lineHeight: 1.55 }}
      >
        Compare-weeks table needs at least one captured snapshot. Either
        flip on demo mode for synthetic history, or wait for the
        Thursday-EOD auto-capture to populate the stream.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-tile)] border border-border bg-card">
      {/* Header row */}
      <div
        className="grid border-b border-border bg-card-alt"
        style={{
          gridTemplateColumns: `minmax(220px, 1.6fr) repeat(${weeks.length}, minmax(48px, 1fr))`,
        }}
      >
        <div
          className="px-3.5 py-2.5 uppercase tracking-[0.5px] text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
        >
          Goal · target
        </div>
        {weeks.map((w) => (
          <div
            key={w.week}
            className="px-1.5 py-2.5 text-center uppercase tracking-[0.5px] text-muted-fg"
            style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}
            title={`${w.week} · captured ${w.capturedAt?.slice(0, 10) ?? "—"}`}
          >
            {w.week}
          </div>
        ))}
      </div>
      {rows.map((row, i) => (
        <Row
          key={row.goalId}
          row={row}
          weeks={weeks}
          isLast={i === rows.length - 1}
        />
      ))}
    </div>
  );
}

function Row({ row, weeks, isLast }) {
  return (
    <div
      className="grid items-center"
      style={{
        gridTemplateColumns: `minmax(220px, 1.6fr) repeat(${weeks.length}, minmax(48px, 1fr))`,
        borderBottom: isLast ? "none" : "1px dashed var(--border)",
      }}
    >
      <div className="px-3.5 py-2.5">
        <div className="truncate text-[12.5px] font-semibold text-fg" title={row.title}>
          {row.title}
        </div>
        <div
          className="mt-0.5 uppercase tracking-[0.5px] text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}
        >
          target {row.target.op} {row.target.value}
        </div>
      </div>
      {weeks.map((w) => {
        const reading = w.goalReadings?.[row.goalId];
        return (
          <Cell
            key={w.week}
            week={w.week}
            reading={reading}
            target={row.target}
          />
        );
      })}
    </div>
  );
}

function Cell({ week, reading, target }) {
  if (!reading) {
    return (
      <Link
        href={`/snapshots#${week}`}
        className="flex h-full items-center justify-center px-1.5 py-2.5 text-dim-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
      >
        —
      </Link>
    );
  }

  // Determine symbol + tone:
  //   met=true  → ✓ accent-2 (green)
  //   met=false → ✗ bad
  //   in progress (no firm met yet, or current window) → ● accent
  //   met=null (no target evaluation) → · muted
  let symbol = "·";
  let color = "var(--muted-fg)";
  let bg = "transparent";
  if (reading.windowMet === true) {
    symbol = "✓";
    color = "var(--good)";
    bg = "rgba(4,120,87,0.08)";
  } else if (reading.windowMet === false) {
    symbol = "✗";
    color = "var(--bad)";
    bg = "rgba(185,28,28,0.06)";
  } else if (reading.cumulative != null) {
    symbol = "●";
    color = "var(--accent)";
    bg = "var(--accent-dim)";
  }

  const valueLabel = formatCellValue(reading);
  const tip = `${week} · ${reading.cadence} window ${reading.cadenceWindow}${
    reading.target ? ` · target ${reading.target.op} ${reading.target.value}` : ""
  }${
    reading.cumulative != null ? ` · cumulative ${formatNumber(reading.cumulative)}` : ""
  }`;

  return (
    <Link
      href={`/snapshots#${week}`}
      title={tip}
      className="flex h-full items-center justify-center gap-1 px-1 py-2 transition-colors hover:bg-card-alt"
      style={{
        background: bg,
        fontFamily: "var(--font-mono)",
        fontSize: 10,
      }}
    >
      <span className="font-bold" style={{ color }}>
        {symbol}
      </span>
      <span style={{ color: "var(--fg)" }}>{valueLabel}</span>
    </Link>
  );
}

function formatCellValue(reading) {
  // Prefer cumulative (it's the more meaningful number for cadence
  // windows that span multiple weeks). Fall back to weekContribution
  // for single-week cadences.
  const v = reading.cumulative ?? reading.weekContribution;
  return formatNumber(v);
}

function formatNumber(n) {
  if (n == null) return "—";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

/**
 * Compact wrapper that renders the table inside a collapsible
 * disclosure block. Mirrors the L1Group pattern in the Goal Tracking
 * section so the visual language stays consistent.
 */
export function WeeklyCompareCard({ groups }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group flex w-full cursor-pointer items-baseline justify-between gap-4 border-b border-border pb-2 text-left transition-colors hover:border-border-strong"
      >
        <div className="flex min-w-0 items-baseline gap-3">
          <span
            aria-hidden="true"
            className="inline-block text-muted-fg transition-transform group-hover:text-fg"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 14,
              lineHeight: 1,
              transform: open ? "rotate(90deg)" : "rotate(0deg)",
              transitionDuration: "200ms",
              transitionTimingFunction: "cubic-bezier(0.22, 0.61, 0.36, 1)",
            }}
          >
            ›
          </span>
          <span
            className="text-accent"
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 20,
              fontWeight: 500,
              lineHeight: 1,
            }}
          >
            Compare
          </span>
          <h3
            className="m-0 font-semibold text-fg"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 17,
              letterSpacing: "-0.3px",
              lineHeight: 1.25,
            }}
          >
            Weekly readings — every goal × the last {MAX_COLS} weeks
          </h3>
        </div>
        <span
          className="uppercase tracking-[0.5px] text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
        >
          ✓ met · ✗ missed · ● in progress
        </span>
      </button>
      {open ? <WeeklyCompareTable groups={groups} /> : null}
    </section>
  );
}

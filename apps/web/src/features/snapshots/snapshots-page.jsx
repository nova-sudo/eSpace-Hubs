"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Button,
  Delta,
  MonoLabel,
  PageHeader,
  Section,
  Stat,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { TrendChart } from "./trend-chart";
import { useSnapshotNow, useSnapshots } from "./use-snapshots";
import { fullDate } from "@/lib/date";

const METRICS = [
  { id: "merged", label: "Merged PRs", unit: "", key: "merged" },
  { id: "reviews", label: "Reviews given", unit: "", key: "reviews" },
  {
    id: "turnaround",
    label: "Turnaround (hours)",
    unit: "h",
    key: "turnaround",
    invert: true,
  },
  { id: "linkage", label: "Jira linkage", unit: "%", key: "linkage" },
  { id: "rounds", label: "Rounds per MR", unit: "", key: "rounds", invert: true },
];

export function SnapshotsPage() {
  const { snapshots } = useSnapshots();
  const snapshotNow = useSnapshotNow();
  const [metric, setMetric] = useState("merged");
  const [selected, setSelected] = useState(snapshots[0]?.week);
  // Optional second selection for "compare to" — falls back to disabled when null.
  // Default it to the LAST snapshot in history so the diff is "now vs first known
  // state" — the most universally useful comparison.
  const [compareWeek, setCompareWeek] = useState(null);

  const active = METRICS.find((m) => m.id === metric);
  // Chart expects oldest → newest
  const series = [...snapshots].reverse();
  const selectedSnap = snapshots.find((s) => s.week === selected) ?? snapshots[0];
  const compareSnap = compareWeek
    ? snapshots.find((s) => s.week === compareWeek)
    : null;

  return (
    <main className="relative z-[2] px-10 pb-14 pt-9">
      <PageHeader
        crumb={
          snapshots.length > 0
            ? `Snapshots · ${snapshots.length} ${snapshots.length === 1 ? "week" : "weeks"}`
            : "Snapshots · no history yet"
        }
        title="Your trend, on record."
        italicWord="trend"
        subtitle="Every Monday we freeze the dashboard into a snapshot. The line you're watching is you, vs. you."
        right={
          <div className="flex gap-2">
            <Link href="/">
              <Button variant="ghost">← Dashboard</Button>
            </Link>
            <Button onClick={() => snapshotNow()}>Snapshot now</Button>
          </div>
        }
      />

      {snapshots.length === 0 ? (
        <EmptyState onCapture={() => snapshotNow()} />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-1.5">
            {METRICS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMetric(m.id)}
                className={cn(
                  "cursor-pointer rounded-[var(--radius-sub)] border px-3.5 py-2 uppercase tracking-[0.3px] transition-colors",
                  metric === m.id
                    ? "border-accent bg-accent text-accent-on"
                    : "border-border bg-transparent text-fg hover:border-border-strong",
                )}
                style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600 }}
              >
                {m.label}
              </button>
            ))}
          </div>

          <TrendChart
            series={series}
            metricKey={active.key}
            metricLabel={active.label}
            unit={active.unit}
            invert={active.invert}
            selected={selected ?? snapshots[0]?.week}
            onSelect={setSelected}
          />

          {selectedSnap ? (
            <Section
              num="01 /"
              title={`Selected week · ${selectedSnap.week} (${fullDate(selectedSnap.capturedAt)})`}
              right={
                <CompareSelector
                  snapshots={snapshots}
                  selected={selected}
                  compareWeek={compareWeek}
                  setCompareWeek={setCompareWeek}
                />
              }
            >
              <div className="grid grid-cols-5 gap-4 py-1.5">
                <Stat label="Merged PRs" value={selectedSnap.merged} sub="in the week" />
                <Stat label="Reviews given" value={selectedSnap.reviews} sub="comments on MRs" />
                <Stat
                  label="Turnaround"
                  value={selectedSnap.turnaround}
                  unit="h"
                  sub="median open → merge"
                />
                <Stat
                  label="Jira linkage"
                  value={`${selectedSnap.linkage}%`}
                  sub="MRs with ticket key"
                />
                <Stat label="Rounds / MR" value={selectedSnap.rounds} sub="reviewer comments" />
              </div>
              {compareSnap ? (
                <CompareGrid base={selectedSnap} other={compareSnap} />
              ) : null}
              <div className="mt-4 rounded-[var(--radius-sub)] border border-dashed border-border bg-card-alt px-4 py-3.5">
                <MonoLabel>Week note</MonoLabel>
                <div
                  className="mt-1 italic"
                  style={{ fontFamily: "var(--font-serif)", fontSize: 17, lineHeight: 1.4 }}
                >
                  {selectedSnap.note
                    ? `"${selectedSnap.note}"`
                    : "No note this week — click Snapshot now with a note to capture one."}
                </div>
              </div>
            </Section>
          ) : null}

          <Section
            num="02 /"
            title="All snapshots"
            right={<MonoLabel>{snapshots.length} weeks</MonoLabel>}
          >
            <SnapshotTable
              snapshots={snapshots}
              selected={selected}
              onSelect={setSelected}
            />
          </Section>
        </>
      )}
    </main>
  );
}

function SnapshotTable({ snapshots, selected, onSelect }) {
  const cols = "62px 56px 110px 80px 80px 90px 80px 80px 1fr";
  return (
    <div className="overflow-hidden rounded-[var(--radius-sub)] border border-border bg-card">
      <div
        className="grid border-b border-border bg-card-alt px-3.5 py-2.5 uppercase tracking-[0.5px] text-muted-fg"
        style={{
          gridTemplateColumns: cols,
          fontFamily: "var(--font-mono)",
          fontSize: 10,
        }}
      >
        <span>Week</span>
        <span>Source</span>
        <span>Date</span>
        <span>Merged</span>
        <span>Reviews</span>
        <span>Turn.</span>
        <span>Link.</span>
        <span>Rounds</span>
        <span>Note · goals</span>
      </div>
      {snapshots.map((s, i) => {
        const isSel = s.week === selected;
        const goalsCount = s.goalReadings
          ? Object.keys(s.goalReadings).length
          : 0;
        return (
          <button
            key={s.week}
            onClick={() => onSelect(s.week)}
            className="grid w-full cursor-pointer items-center px-3.5 py-3 text-left"
            style={{
              gridTemplateColumns: cols,
              borderBottom:
                i < snapshots.length - 1 ? "1px dashed var(--border)" : "none",
              background: isSel ? "var(--accent-dim)" : "transparent",
              fontSize: 13,
            }}
          >
            <span
              className="font-bold"
              style={{
                fontFamily: "var(--font-mono)",
                color: isSel ? "var(--accent)" : "var(--fg)",
              }}
            >
              {s.week}
            </span>
            {/* Capture-source pill: AUTO (mono accent) vs MANUAL (muted) */}
            <span
              className="inline-flex items-center justify-center rounded-[3px] px-1.5 py-0.5 uppercase"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 8.5,
                letterSpacing: "0.5px",
                fontWeight: 700,
                background:
                  s.capturedBy === "auto"
                    ? "var(--accent-dim)"
                    : "var(--card-alt)",
                color:
                  s.capturedBy === "auto"
                    ? "var(--accent)"
                    : "var(--muted-fg)",
                border: "1px solid var(--border)",
              }}
            >
              {s.capturedBy === "auto" ? "auto" : "manual"}
            </span>
            <span
              className="text-muted-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
            >
              {fullDate(s.capturedAt)}
            </span>
            <span className="font-semibold" style={{ fontFamily: "var(--font-display)" }}>
              {s.merged}
            </span>
            <span className="font-semibold" style={{ fontFamily: "var(--font-display)" }}>
              {s.reviews}
            </span>
            <span style={{ fontFamily: "var(--font-mono)" }}>{s.turnaround}h</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>{s.linkage}%</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>{s.rounds}</span>
            <span className="truncate text-muted-fg" style={{ fontSize: 12.5 }}>
              {s.note || "—"}
              {goalsCount > 0 ? (
                <span
                  className="ml-2"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--accent)",
                  }}
                >
                  · {goalsCount} goal{goalsCount === 1 ? "" : "s"}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Compare-week dropdown shown next to the "Selected week" header. The list
 * filters out the currently-selected week (it'd diff to zero) and a
 * "no comparison" option lets the user collapse back to single-snapshot view.
 */
function CompareSelector({ snapshots, selected, compareWeek, setCompareWeek }) {
  const candidates = snapshots.filter((s) => s.week !== selected);
  return (
    <label
      className="inline-flex items-center gap-2"
      style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
    >
      <span className="uppercase tracking-[0.5px] text-muted-fg">
        Compare to
      </span>
      <select
        value={compareWeek || ""}
        onChange={(e) => setCompareWeek(e.target.value || null)}
        className="cursor-pointer rounded-[var(--radius-sub)] border border-border bg-card px-2 py-1"
        style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
      >
        <option value="">— none —</option>
        {candidates.map((s) => (
          <option key={s.week} value={s.week}>
            {s.week} · {fullDate(s.capturedAt)}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Inline compare grid — same 5 stats as the selected-week row, but with
 * a Delta chip per metric. Lower-is-better metrics (turnaround, rounds)
 * pass `invert` so the chip colors reflect what direction the user wants.
 */
function CompareGrid({ base, other }) {
  const rows = [
    { key: "merged", label: "Merged PRs", invert: false },
    { key: "reviews", label: "Reviews given", invert: false },
    { key: "turnaround", label: "Turnaround (h)", invert: true },
    { key: "linkage", label: "Linkage (%)", invert: false },
    { key: "rounds", label: "Rounds / MR", invert: true },
  ];
  return (
    <div className="mt-3 overflow-hidden rounded-[var(--radius-sub)] border border-border bg-card-alt">
      <div
        className="grid border-b border-border bg-card px-3.5 py-2 uppercase tracking-[0.5px] text-muted-fg"
        style={{
          gridTemplateColumns: "1.4fr 1fr 1fr 0.8fr",
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
        }}
      >
        <span>Metric</span>
        <span>{base.week}</span>
        <span>{other.week}</span>
        <span className="text-right">Δ</span>
      </div>
      {rows.map((r) => {
        const a = Number(base[r.key]) || 0;
        const b = Number(other[r.key]) || 0;
        const delta = a - b;
        return (
          <div
            key={r.key}
            className="grid items-center border-b border-border border-dashed px-3.5 py-2 last:border-b-0"
            style={{
              gridTemplateColumns: "1.4fr 1fr 1fr 0.8fr",
              fontSize: 13,
            }}
          >
            <span className="text-muted-fg" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
              {r.label}
            </span>
            <span className="font-semibold" style={{ fontFamily: "var(--font-display)" }}>
              {a}
            </span>
            <span className="text-muted-fg" style={{ fontFamily: "var(--font-mono)" }}>
              {b}
            </span>
            <span className="text-right">
              <Delta value={delta > 0 ? `+${delta}` : `${delta}`} invert={r.invert} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ onCapture }) {
  return (
    <div className="rounded-[var(--radius-tile)] border border-dashed border-border-strong bg-card px-10 py-16 text-center">
      <MonoLabel>No snapshots yet</MonoLabel>
      <h2
        className="mx-auto mt-3 max-w-[520px] font-semibold"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 28,
          letterSpacing: "-0.8px",
        }}
      >
        Capture your first snapshot to start building a trend.
      </h2>
      <p className="mx-auto mt-2 max-w-[480px] text-[13px] text-muted-fg">
        A snapshot freezes your headline metrics for this week. Take one now, then
        let the app prompt you every Monday.
      </p>
      <div className="mt-6 flex justify-center">
        <Button onClick={onCapture}>Snapshot now</Button>
      </div>
    </div>
  );
}

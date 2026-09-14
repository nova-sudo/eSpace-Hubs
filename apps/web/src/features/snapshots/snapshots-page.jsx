"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Delta,
  Label,
  PageHeader,
  Section,
  SegmentedControl,
  Select,
  Stat,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { TrendChart } from "./trend-chart";
import { useSnapshotNow, useSnapshots } from "./use-snapshots";
import { useHubLink } from "@/features/hubs";
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
  const { snapshots, fetched } = useSnapshots();
  const snapshotNow = useSnapshotNow();
  const link = useHubLink();
  const [metric, setMetric] = useState("merged");
  // #239: pending state so "Snapshot now" can't double-fire, with a
  // toast so the click visibly did something.
  const [capturing, setCapturing] = useState(false);
  async function handleSnapshotNow() {
    if (capturing) return;
    setCapturing(true);
    try {
      await snapshotNow();
      toast.success("Snapshot captured.");
    } catch (err) {
      toast.error(`Snapshot failed: ${err?.message || err}`);
    } finally {
      setCapturing(false);
    }
  }
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
    <main className="relative z-[2] px-4 sm:px-10 pb-14 pt-9">
      <PageHeader
        crumb={
          snapshots.length > 0
            ? `Snapshots · ${snapshots.length} ${snapshots.length === 1 ? "week" : "weeks"}`
            : fetched
              ? "Snapshots · no history yet"
              : "Snapshots · loading…"
        }
        title="Your trend, on record."
        // Honest cadence (#239): capture fires on dashboard visits (plus
        // this button) — there is no Monday cron yet (F4's snapshot half).
        subtitle="Each week you visit gets frozen into a snapshot. The line you're watching is you, vs. you."
        right={
          <div className="flex gap-2">
            <Link href={link("")}>
              <Button variant="ghost">
                <ArrowLeft size={14} /> Intelligence
              </Button>
            </Link>
            <Button onClick={() => void handleSnapshotNow()} disabled={capturing}>
              {capturing ? "Capturing…" : "Snapshot now"}
            </Button>
          </div>
        }
      />

      {snapshots.length === 0 ? (
        // Gate on `fetched` — this used to flash "no history yet" on
        // every load while the fetch was still in flight (#239).
        fetched ? (
          <EmptyState onCapture={() => void handleSnapshotNow()} />
        ) : null
      ) : (
        <>
          <div className="mb-5">
            <SegmentedControl
              options={METRICS.map((m) => ({ value: m.id, label: m.label }))}
              value={metric}
              onChange={setMetric}
              size="sm"
            />
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
              <Card className="grid grid-cols-5 gap-4">
                <Stat label="Merged PRs" value={selectedSnap.merged} sub="in the week" />
                <Stat
                  label="Reviews given"
                  value={selectedSnap.reviews}
                  sub="comments on MRs"
                />
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
              </Card>
              {compareSnap ? (
                <CompareGrid base={selectedSnap} other={compareSnap} />
              ) : null}
              <div className="mt-4 rounded-[var(--radius-lg)] bg-card-alt px-4 py-3.5">
                <Label>Week note</Label>
                <div className="mt-1 text-[14.5px] italic leading-[1.4] text-fg">
                  {selectedSnap.note
                    ? `"${selectedSnap.note}"`
                    : "No note this week — click Snapshot now with a note to capture one."}
                </div>
              </div>
            </Section>
          ) : null}

          <Section title="All snapshots" right={<Label>{snapshots.length} weeks</Label>}>
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
  const cols = "62px 76px 110px 80px 80px 90px 80px 80px 1fr";
  return (
    <Card padding={0} className="overflow-hidden">
      <div
        className="grid border-b border-line px-3.5 py-2.5"
        style={{ gridTemplateColumns: cols }}
      >
        {["Week", "Source", "Date", "Merged", "Reviews", "Turn.", "Link.", "Rounds", "Note · goals"].map(
          (h) => (
            <Label key={h}>{h}</Label>
          ),
        )}
      </div>
      {snapshots.map((s) => {
        const isSel = s.week === selected;
        const goalsCount = s.goalReadings
          ? Object.keys(s.goalReadings).length
          : 0;
        const sourceBadge =
          s.capturedBy === "auto"
            ? s.partial
              ? "Auto · partial"
              : "Auto"
            : s.partial
              ? "Partial"
              : null;
        return (
          <button
            key={s.week}
            onClick={() => onSelect(s.week)}
            className={cn(
              "grid w-full cursor-pointer items-center border-t border-line px-3.5 py-3 text-left first:border-t-0 text-[13px]",
              isSel ? "bg-card-alt" : "hover:bg-card-alt",
            )}
            style={{ gridTemplateColumns: cols }}
          >
            <span className={cn("font-mono font-bold", isSel ? "text-fg" : "text-fg")}>
              {s.week}
            </span>
            {sourceBadge ? <Badge tone="sky">{sourceBadge}</Badge> : <span />}
            <span className="text-muted-fg">{fullDate(s.capturedAt)}</span>
            <span className="font-bold tabular-nums">{s.merged}</span>
            <span className="font-bold tabular-nums">{s.reviews}</span>
            <span className="tabular-nums">{s.turnaround}h</span>
            <span className="tabular-nums">{s.linkage}%</span>
            <span className="tabular-nums">{s.rounds}</span>
            <span className="truncate text-muted-fg">
              {s.note || "—"}
              {goalsCount > 0 ? (
                <span className="ml-2 text-dim-fg">
                  · {goalsCount} goal{goalsCount === 1 ? "" : "s"}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </Card>
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
    <label className="inline-flex items-center gap-2">
      <Label>Compare to</Label>
      <Select
        tone="default"
        size="sm"
        value={compareWeek || ""}
        onChange={(e) => setCompareWeek(e.target.value || null)}
      >
        <option value="">— none —</option>
        {candidates.map((s) => (
          <option key={s.week} value={s.week}>
            {s.week} · {fullDate(s.capturedAt)}
          </option>
        ))}
      </Select>
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
    <Card padding={0} className="mt-3 overflow-hidden">
      <div
        className="grid border-b border-line px-3.5 py-2"
        style={{ gridTemplateColumns: "1.4fr 1fr 1fr 0.8fr" }}
      >
        <Label>Metric</Label>
        <Label>{base.week}</Label>
        <Label>{other.week}</Label>
        <Label className="text-right">Δ</Label>
      </div>
      {rows.map((r) => {
        const a = Number(base[r.key]) || 0;
        const b = Number(other[r.key]) || 0;
        const delta = a - b;
        return (
          <div
            key={r.key}
            className="grid items-center border-t border-line px-3.5 py-2 text-[13px]"
            style={{ gridTemplateColumns: "1.4fr 1fr 1fr 0.8fr" }}
          >
            <span className="text-muted-fg">{r.label}</span>
            <span className="font-bold tabular-nums">{a}</span>
            <span className="text-muted-fg tabular-nums">{b}</span>
            <span className="text-right">
              <Delta value={delta > 0 ? `+${delta}` : `${delta}`} invert={r.invert} />
            </span>
          </div>
        );
      })}
    </Card>
  );
}

function EmptyState({ onCapture }) {
  return (
    <Card className="px-4 sm:px-10 py-16 text-center">
      <Label>No snapshots yet</Label>
      <h2 className="mx-auto mt-3 max-w-[520px] text-[18px] font-bold tracking-[-0.01em] text-fg">
        Capture your first snapshot to start building a trend.
      </h2>
      <p className="mx-auto mt-2 max-w-[480px] text-[13px] text-muted-fg">
        A snapshot freezes your headline metrics for this week. Take one now, then
        let the app prompt you every Monday.
      </p>
      <div className="mt-6 flex justify-center">
        <Button onClick={onCapture}>Snapshot now</Button>
      </div>
    </Card>
  );
}

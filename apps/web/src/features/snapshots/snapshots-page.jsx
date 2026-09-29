"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DrillDownNav } from "@/components/shell/drill-down-nav";
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
import {
  lacksProviderMetrics,
  useSnapshotNow,
  useSnapshotReadiness,
  useSnapshots,
} from "./use-snapshots";
import { updateSnapshotNote } from "./snapshots-store";
import { useApiOrigin } from "@/features/companion";
import { fullDate } from "@/lib/date";
import { plural } from "@/lib/fmt";

/** Tooltip copy for the source badges — what "auto" and "partial" mean. */
const SOURCE_HINT = {
  auto: "Captured automatically when the work-week ended (dashboard visit or the weekly server job) — not something you clicked.",
  partial:
    "Captured without your provider data, so PR and review numbers are unknown (shown as —). Manual-tracker readings are real.",
  manual: "Captured by you with Snapshot now.",
};

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
  const { snapshots, fetched, loading, error, retry } = useSnapshots();
  const snapshotNow = useSnapshotNow();
  const readiness = useSnapshotReadiness();
  const { source, staleHostname } = useApiOrigin();
  // A paired companion whose heartbeat went stale: provider routes 502
  // until it's back, so a capture now would freeze zeros.
  const companionOffline = source === "bundled" && Boolean(staleHostname);
  const canCapture = readiness.ready && !companionOffline;
  const captureHint = companionOffline
    ? "Companion offline — open the desktop app before capturing."
    : readiness.reason;
  const [metric, setMetric] = useState("merged");
  // #239: pending state so "Snapshot now" can't double-fire, with a
  // toast so the click visibly did something.
  const [capturing, setCapturing] = useState(false);
  // The toast's Retry calls this from an OLD render's closure, where
  // `capturing` was false and `canCapture` frozen — so the guard reads
  // refs: one capture in flight at a time, against the live readiness.
  const capturingRef = useRef(false);
  const canCaptureRef = useRef(canCapture);
  useLayoutEffect(() => {
    canCaptureRef.current = canCapture;
  });
  async function handleSnapshotNow() {
    if (capturingRef.current || !canCaptureRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    try {
      const r = await snapshotNow();
      if (r?.ok === false) {
        toast.error(
          `Couldn't save snapshot: ${r.error?.message || "the server didn't respond"}`,
          { action: { label: "Retry", onClick: () => void handleSnapshotNow() } },
        );
        return;
      }
      toast.success("Snapshot captured.");
    } catch (err) {
      toast.error(`Couldn't save snapshot: ${err?.message || err}`, {
        action: { label: "Retry", onClick: () => void handleSnapshotNow() },
      });
    } finally {
      capturingRef.current = false;
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
  const loadFailed = fetched && snapshots.length === 0 && Boolean(error);

  return (
    <main className="relative z-[2] px-4 sm:px-10 pb-14 pt-9">
      <PageHeader
        crumb={
          snapshots.length > 0
            ? `Snapshots · ${snapshots.length} ${snapshots.length === 1 ? "week" : "weeks"}`
            : fetched
              ? loadFailed
                ? "Snapshots · couldn't load"
                : "Snapshots · no history yet"
              : "Snapshots · loading…"
        }
        title="Your trend, on record."
        subtitle="One row per week, Sunday to Saturday — the same weeks your trackers use. The line you're watching is you, vs. you."
        right={
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex gap-2">
              <Button
                onClick={() => void handleSnapshotNow()}
                disabled={capturing || !canCapture}
                title={!canCapture ? captureHint || undefined : undefined}
              >
                {capturing ? "Capturing…" : "Snapshot now"}
              </Button>
            </div>
            <span className="max-w-[420px] text-right text-[12px] leading-[1.4] text-muted-fg">
              {!canCapture && captureHint
                ? captureHint
                : "Each completed week is captured for you when you open the dashboard (or by the weekly server job). Snapshot now adds a mid-week reading of the current week."}
            </span>
          </div>
        }
      />
      <DrillDownNav className="-mt-2 mb-7" />

      {snapshots.length === 0 ? (
        // Gate on `fetched` — this used to flash "no history yet" on
        // every load while the fetch was still in flight (#239).
        loadFailed ? (
          <Card className="flex flex-col items-start gap-3">
            <div className="text-[15px] font-bold text-peach-text">Couldn&apos;t load snapshots</div>
            <p className="text-[13px] leading-[1.5] text-muted-fg">
              {error?.message || "The server didn't respond. Check your connection and try again."}
            </p>
            <Button onClick={() => void retry()} disabled={loading}>
              {loading ? "Retrying…" : "Retry"}
            </Button>
          </Card>
        ) : fetched ? (
          <EmptyState
            onCapture={() => void handleSnapshotNow()}
            disabled={capturing || !canCapture}
            hint={!canCapture ? captureHint : null}
          />
        ) : null
      ) : (
        <>
          <div className="mb-5">
            <SegmentedControl as="radiogroup" ariaLabel="Chart metric"
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
              <Card className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {(() => {
                  // No provider data that week: the zeros are unknowns.
                  const na = lacksProviderMetrics(selectedSnap);
                  const naSub = "provider data unavailable";
                  return (
                    <>
                      <Stat
                        label="Merged PRs"
                        value={na ? "—" : selectedSnap.merged}
                        sub={na ? naSub : "in the week"}
                      />
                      <Stat
                        label="Reviews given"
                        value={na ? "—" : selectedSnap.reviews}
                        sub={na ? naSub : "comments on MRs"}
                      />
                      <Stat
                        label="Turnaround"
                        value={na ? "—" : selectedSnap.turnaround}
                        unit={na ? undefined : "h"}
                        sub={na ? naSub : "median open → merge"}
                      />
                      <Stat
                        label="Jira linkage"
                        value={na ? "—" : `${selectedSnap.linkage}%`}
                        sub={na ? naSub : "MRs with ticket key"}
                      />
                      <Stat
                        label="Rounds / MR"
                        value={na ? "—" : selectedSnap.rounds}
                        sub={na ? naSub : "reviewer comments"}
                      />
                    </>
                  );
                })()}
              </Card>
              {compareSnap ? (
                <CompareGrid base={selectedSnap} other={compareSnap} />
              ) : null}
              <WeekNote key={selectedSnap.week} snapshot={selectedSnap} />
            </Section>
          ) : null}

          <Section title="All snapshots" right={<Label>{plural(snapshots.length, "week")}</Label>}>
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

/**
 * The week's note — read view plus an inline editor wired to
 * `updateSnapshotNote`. Keyed by week from the parent so switching
 * weeks discards an unsaved draft rather than carrying it across.
 */
function WeekNote({ snapshot }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(snapshot.note || "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    setSaving(true);
    const r = await updateSnapshotNote(snapshot.week, draft.trim());
    setSaving(false);
    if (!r?.ok) {
      toast.error(
        `Couldn't save note: ${r?.error?.message || "the server didn't respond"}`,
        { action: { label: "Retry", onClick: () => void save() } },
      );
      return;
    }
    setEditing(false);
    toast.success("Note saved.");
  }

  return (
    <div className="mt-4 rounded-[var(--radius-lg)] bg-card-alt px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <Label>Week note</Label>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="link-target text-[12px] font-bold text-fg hover:underline"
          >
            {snapshot.note ? "Edit note" : "Add note"}
          </button>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-2 flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            maxLength={8000}
            autoFocus
            placeholder="What made this week what it was — a shipped feature, an incident, a week off…"
            className="w-full resize-y rounded-[var(--radius-lg)] bg-card p-3 text-[14px] leading-[1.5] text-fg border border-field-line outline-none placeholder:text-dim-fg focus:ring-2 focus:ring-ink"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save note"}
            </Button>
            <Button
              size="sm"
              variant="soft"
              onClick={() => {
                setDraft(snapshot.note || "");
                setEditing(false);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-1 text-[14.5px] italic leading-[1.4] text-fg">
          {snapshot.note ? `"${snapshot.note}"` : "No note this week yet."}
        </div>
      )}
    </div>
  );
}

function SnapshotTable({ snapshots, selected, onSelect }) {
  // Fixed-min columns inside a horizontal scroller: nothing is clipped at
  // 390px, the Source badge has room, and the week key never wraps.
  const cols =
    "minmax(96px,auto) minmax(116px,auto) 112px 72px 72px 72px 72px 72px minmax(160px,1fr)";
  const headers = ["Week", "Source", "Date", "Merged", "Reviews", "Turn.", "Link.", "Rounds", "Note · goals"];
  return (
    <Card padding={0} className="overflow-hidden">
      <div className="overflow-x-auto">
        <div role="table" aria-label="All snapshots" className="min-w-[860px]">
          <div role="rowgroup">
            <div
              role="row"
              className="grid border-b border-line px-3.5 py-2.5"
              style={{ gridTemplateColumns: cols }}
            >
              {headers.map((h) => (
                <Label key={h} role="columnheader">
                  {h}
                </Label>
              ))}
            </div>
          </div>
          <div role="rowgroup">
            {snapshots.map((s) => {
              const isSel = s.week === selected;
              const na = lacksProviderMetrics(s);
              const goalsCount = s.goalReadings ? Object.keys(s.goalReadings).length : 0;
              const sourceBadge =
                s.capturedBy === "auto"
                  ? s.partial
                    ? "Auto · partial"
                    : "Auto"
                  : s.partial
                    ? "Partial"
                    : null;
              const sourceHint = s.partial
                ? `${s.capturedBy === "auto" ? `${SOURCE_HINT.auto} ` : ""}${SOURCE_HINT.partial}`
                : s.capturedBy === "auto"
                  ? SOURCE_HINT.auto
                  : SOURCE_HINT.manual;
              const metric = (v, suffix = "") => (na ? "—" : `${v}${suffix}`);
              return (
                <div
                  key={s.week}
                  role="row"
                  aria-current={isSel ? "true" : undefined}
                  onClick={() => onSelect(s.week)}
                  className={cn(
                    "relative grid w-full cursor-pointer items-center border-t border-line px-3.5 py-3 text-left text-[13px] first:border-t-0",
                    isSel ? "bg-card-alt" : "hover:bg-card-alt",
                  )}
                  style={{ gridTemplateColumns: cols }}
                >
                  {isSel ? (
                    <span
                      aria-hidden
                      className="absolute inset-y-1.5 left-0 w-[3px] rounded-[var(--radius-pill)] bg-ink"
                    />
                  ) : null}
                  <span role="cell">
                    <button
                      type="button"
                      aria-pressed={isSel}
                      aria-label={`Week ${s.week}, captured ${fullDate(s.capturedAt)}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(s.week);
                      }}
                      className="whitespace-nowrap rounded-[var(--radius-md)] font-mono font-bold text-fg"
                    >
                      {s.week}
                    </button>
                  </span>
                  <span role="cell" className="whitespace-nowrap">
                    {sourceBadge ? (
                      <Badge tone="sky" title={sourceHint}>
                        {sourceBadge}
                      </Badge>
                    ) : (
                      <span title={sourceHint} className="text-muted-fg">
                        Manual
                      </span>
                    )}
                  </span>
                  <span role="cell" className="whitespace-nowrap text-muted-fg">
                    {fullDate(s.capturedAt)}
                  </span>
                  <span role="cell" className="font-bold tabular-nums">{metric(s.merged)}</span>
                  <span role="cell" className="font-bold tabular-nums">{metric(s.reviews)}</span>
                  <span role="cell" className="tabular-nums">{metric(s.turnaround, "h")}</span>
                  <span role="cell" className="tabular-nums">{metric(s.linkage, "%")}</span>
                  <span role="cell" className="tabular-nums">{metric(s.rounds)}</span>
                  <span role="cell" className="truncate text-muted-fg">
                    {s.note || "—"}
                    {goalsCount > 0 ? (
                      <span className="ml-2 text-muted-fg">· {plural(goalsCount, "goal")}</span>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
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
        <Label className="text-right">Change</Label>
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

function EmptyState({ onCapture, disabled, hint }) {
  return (
    <Card className="px-4 sm:px-10 py-16 text-center">
      <Label>No snapshots yet</Label>
      <h2 className="mx-auto mt-3 max-w-[520px] text-[18px] font-bold tracking-[-0.01em] text-fg">
        Capture your first snapshot to start building a trend.
      </h2>
      <p className="mx-auto mt-2 max-w-[480px] text-[13px] text-muted-fg">
        A snapshot freezes your headline metrics for one week. Completed weeks are
        captured for you when you open the dashboard; Snapshot now records the
        current week as it stands.
      </p>
      <div className="mt-6 flex flex-col items-center gap-2">
        <Button onClick={onCapture} disabled={disabled} title={hint || undefined}>
          Snapshot now
        </Button>
        {hint ? <span className="text-[12px] text-muted-fg">{hint}</span> : null}
      </div>
    </Card>
  );
}

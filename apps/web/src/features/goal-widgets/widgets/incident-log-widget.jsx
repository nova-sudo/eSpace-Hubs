"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Badge, Button, IconButton, Input, Label, Select } from "@/components/ui";
import { cn } from "@/lib/cn";
import { WidgetShell } from "../widget-shell";
import { useGoalInputs } from "@/features/goal-inputs";
import { fullDate } from "@/lib/date";
import {
  SEVERITY_LEVELS,
  inferIncidentMode,
  filterByPeriod,
  isDefectEntry,
  latestDeliverables,
  summarizeDefects,
  defectRatePct,
} from "@/lib/defects";

/**
 * Incident / defect log — one entry per SLA-affecting event or escaped defect.
 *
 * Runs in one of two modes, chosen by `spec.manual.unit` (see
 * `inferIncidentMode` in lib/defects.js):
 *
 *   1. **Duration mode** (unit = "minutes" / "hours" / time-words):
 *      an SLA downtime budget ("≤ 43 minutes/quarter"). Headline shows
 *      `Σ downtime / budget`; the numeric input is required. Unchanged —
 *      this is the classic reliability case.
 *
 *   2. **Defect / count mode** (unit = "defects" / "incidents" / "bugs" / …):
 *      the goal is about escaped defects. Beyond the count-vs-budget the
 *      widget now lets you record what the achievement-tier criteria actually
 *      ask for, so a single well-handled defect grades fairly instead of
 *      "not achieved" for missing data the widget never captured:
 *        - **Deliverables shipped this period** → a real defect RATE
 *          (defects ÷ deliverables), the "≤10%" the criteria are written in.
 *        - **Per-defect documentation**: root-cause analysis, corrective
 *          action, and preventive-action status (open / closed).
 *      All of it flows into `buildCurrentData` so the grader sees the rate +
 *      documentation, not just "N incidents logged".
 *
 * Deliverables are stored as their own goal-inputs entry (`{ deliverables }`,
 * no severity); defects are entries WITH a severity. Both are windowed to the
 * current cadence period so the rate/budget reset each quarter.
 */
export function IncidentLogWidget({
  spec,
  goal,
  variant = "light",
  className,
  onRetry,
}) {
  const { entries, append, remove } = useGoalInputs(goal?.id);
  const [severity, setSeverity] = useState("P2");
  const [downtime, setDowntime] = useState("");
  const [rca, setRca] = useState("");
  const [action, setAction] = useState("");
  const [preventiveClosed, setPreventiveClosed] = useState(false);

  const target = spec.manual?.target;
  const period = target?.period || spec.manual?.cadence;
  const unit = spec.manual?.unit || "minutes";
  const isCountMode = inferIncidentMode(unit) === "count";

  // Window every entry to the current cadence period, then split into defects
  // (have a severity) and the deliverables denominator.
  const windowed = useMemo(
    () => filterByPeriod(entries, period),
    [entries, period],
  );
  const defects = useMemo(() => windowed.filter(isDefectEntry), [windowed]);
  // Deliverables is a persistent scalar read over ALL entries (not windowed) —
  // the denominator must not age out from under a later-logged defect.
  const deliverables = useMemo(
    () => (isCountMode ? latestDeliverables(entries) : null),
    [entries, isCountMode],
  );
  const totals = useMemo(() => summarizeDefects(defects), [defects]);
  const rate = isCountMode ? defectRatePct(defects.length, deliverables) : null;
  // The headline/rate/chips are per-period, but the log LIST shows the full
  // history (all defect entries) so past periods aren't hidden — matching the
  // widget's original behaviour.
  const allDefects = useMemo(
    () => (Array.isArray(entries) ? entries.filter(isDefectEntry) : []),
    [entries],
  );

  // Count mode sums entries; duration mode sums downtime minutes.
  const headlineValue = isCountMode ? totals.count : totals.totalDowntime;

  // Numeric downtime — required in duration mode, optional in count mode.
  const trimmedDowntime = downtime.trim();
  const minutesValue = trimmedDowntime === "" ? null : Number(trimmedDowntime);
  const minutesValid =
    trimmedDowntime === ""
      ? isCountMode
      : Number.isFinite(minutesValue) && minutesValue >= 0;

  function logIncident() {
    if (!minutesValid) return;
    const trimmedRca = rca.trim();
    const trimmedAction = action.trim();
    append({
      severity,
      ...(Number.isFinite(minutesValue) && minutesValue >= 0
        ? { downtime: minutesValue }
        : {}),
      ...(trimmedRca ? { rca: trimmedRca } : {}),
      ...(isCountMode && trimmedAction ? { action: trimmedAction } : {}),
      ...(isCountMode
        ? { preventive: preventiveClosed ? "closed" : "open" }
        : {}),
    });
    setDowntime("");
    setRca("");
    setAction("");
    setPreventiveClosed(false);
  }

  const shellLabel = isCountMode
    ? `${capitalize(pluralUnit(unit))} · ${totals.count}`
    : `Incidents · ${totals.count}`;

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={shellLabel}
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col gap-2">
        {rate != null ? (
          <RateHeadline rate={rate} defectCount={totals.count} deliverables={deliverables} totals={totals} period={period} />
        ) : (
          <Headline
            totals={totals}
            headlineValue={headlineValue}
            budget={target?.value}
            unit={unit}
            period={period}
            mode={isCountMode ? "count" : "duration"}
          />
        )}

        {isCountMode ? (
          // Key on goal + stored value so the field re-seeds from the truth
          // when either changes (the value only moves on blur/commit, so this
          // never interrupts typing).
          <DeliverablesField
            key={`deliverables-${goal?.id}-${deliverables ?? ""}`}
            deliverables={deliverables}
            period={period}
            onCommit={(n) => append({ deliverables: n })}
          />
        ) : null}

        <Label>
          {spec.manual?.prompt ||
            (isCountMode
              ? `Log this ${singularUnit(unit)}: severity, root cause, corrective + preventive action.`
              : "Log this incident: severity, downtime, link.")}
        </Label>

        {totals.bySeverity.length > 0 ? <SeverityRow distribution={totals.bySeverity} /> : null}

        {/* Input row. severity is a tight <select>; count mode adds the
            documentation fields the tier criteria grade against. Same min-w-0
            wrapping chain as the date-log widget so it never overflows. */}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Select size="sm" value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity">
            {SEVERITY_LEVELS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Input
            type="number"
            min={0}
            value={downtime}
            onChange={(e) => setDowntime(e.target.value)}
            placeholder={isCountMode ? "min (opt)" : "min"}
            className="w-20 min-w-0"
            aria-label={isCountMode ? "Duration (optional, minutes)" : "Downtime (minutes)"}
          />
          <Input
            value={rca}
            onChange={(e) => setRca(e.target.value)}
            placeholder={isCountMode ? "root cause" : "post-mortem (optional)"}
            className="min-w-0 flex-1"
            aria-label={isCountMode ? "Root-cause analysis" : "Post-mortem link"}
          />
          {isCountMode ? (
            <>
              <Input
                value={action}
                onChange={(e) => setAction(e.target.value)}
                placeholder="corrective / preventive action"
                className="min-w-0 flex-1"
                aria-label="Corrective and preventive action"
              />
              <button
                type="button"
                onClick={() => setPreventiveClosed((v) => !v)}
                aria-pressed={preventiveClosed}
                title="Mark the preventive action as closed (done) vs open"
                className={cn(
                  "shrink-0 rounded-[var(--radius-pill)] px-2.5 py-1 text-[11.5px] font-bold transition-colors",
                  preventiveClosed ? "bg-mint text-mint-ink" : "bg-card-alt text-muted-fg",
                )}
              >
                {preventiveClosed ? "Prev done" : "Prev open"}
              </button>
            </>
          ) : null}
          <Button size="sm" disabled={!minutesValid} className="shrink-0" onClick={logIncident}>
            Log
          </Button>
        </div>

        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1 text-[13px]">
          {allDefects
            .slice()
            .reverse()
            .map((e) => {
              const v = e.value || {};
              const rcaText = v.rca || v.link || "";
              const rcaIsLink = /^https?:\/\//i.test(rcaText);
              return (
                <li key={e.ts} className="group flex items-center gap-2 rounded-[var(--radius-md)] bg-card-alt px-2 py-1.5">
                  <span className="shrink-0 font-bold text-fg">{fullDate(e.ts)}</span>
                  <Badge tone={severityTone(v.severity)} className="shrink-0">
                    {v.severity || "—"}
                  </Badge>
                  {Number.isFinite(v.downtime) ? <span className="text-fg">{v.downtime}m</span> : null}
                  {isCountMode ? <DocMarkers v={v} /> : null}
                  {rcaText ? (
                    rcaIsLink ? (
                      <a
                        href={rcaText}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 flex-1 truncate font-bold text-fg underline-offset-2 hover:underline"
                        title={rcaText}
                      >
                        {isCountMode ? "root cause" : "post-mortem"}
                      </a>
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-muted-fg" title={rcaText}>
                        {rcaText}
                      </span>
                    )
                  ) : (
                    <span className="flex-1" />
                  )}
                  <IconButton
                    label="Remove"
                    size="sm"
                    onCard
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={() => remove(e.ts)}
                  >
                    <X size={12} />
                  </IconButton>
                </li>
              );
            })}
        </ul>
      </div>
    </WidgetShell>
  );
}

/* ────────────────────────── inputs / styling ────────────────────────── */

/**
 * The rate denominator. A number the user maintains per period; committing on
 * blur / Enter appends a `{ deliverables }` entry (last write wins in-window).
 * Seeded from the stored value so it reflects what's persisted.
 */
function DeliverablesField({ deliverables, period, onCommit }) {
  const [draft, setDraft] = useState(
    deliverables != null ? String(deliverables) : "",
  );

  function commit() {
    const t = draft.trim();
    if (t === "") return;
    const n = Math.round(Number(t));
    if (!Number.isFinite(n) || n < 0) return;
    if (n === deliverables) return; // no-op — don't spam entries
    onCommit(n);
  }

  return (
    <label className="flex items-center gap-1.5 text-[12.5px] text-muted-fg">
      <span>Deliverables{period ? ` this ${period}` : ""}</span>
      <Input
        type="number"
        min={0}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            // Just blur — onBlur commits. Calling commit() here too would
            // double-append (blur() fires onBlur synchronously before the
            // no-op guard's stale prop updates).
            e.currentTarget.blur();
          }
        }}
        placeholder="—"
        className="w-20"
        aria-label="Deliverables shipped this period"
      />
    </label>
  );
}

/** Compact per-defect documentation markers in the log row. */
function DocMarkers({ v }) {
  const hasRca = !!(v.rca || v.link);
  const hasAction = !!v.action;
  const prevClosed = v.preventive === "closed";
  return (
    <span
      className="shrink-0 text-[11px]"
      title={`root cause: ${hasRca ? "yes" : "no"} · corrective action: ${
        hasAction ? "yes" : "no"
      } · preventive: ${v.preventive || "—"}`}
    >
      <span className={hasRca ? "text-fg" : "text-dim-fg"}>RCA</span>
      <span className="text-dim-fg"> · </span>
      <span className={hasAction ? "text-fg" : "text-dim-fg"}>ACT</span>
      <span className="text-dim-fg"> · </span>
      <span className={prevClosed ? "text-fg" : "text-dim-fg"}>{prevClosed ? "Prev done" : "Prev"}</span>
    </span>
  );
}

/* ────────────────────────── headlines ────────────────────────── */

/**
 * Defect-rate headline (count mode, deliverables known). Rate is the big
 * number; the sub-lines carry the denominator + documentation coverage so the
 * tile reads the same story the grader sees.
 */
function RateHeadline({ rate, defectCount, deliverables, totals, period }) {
  const docBits = [];
  if (defectCount > 0) {
    docBits.push(
      totals.fullyDocumented
        ? "all documented"
        : `docs ${Math.min(totals.withRca, totals.withAction)}/${defectCount}`,
    );
    if (totals.preventiveOpen > 0) docBits.push(`${totals.preventiveOpen} prev open`);
    if (totals.major > 0) docBits.push(`${totals.major} major`);
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <div className="text-[30px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg sm:text-[36px]">
          {rate}%
        </div>
        <span className="text-[13px] text-muted-fg">
          defect rate · {defectCount} / {deliverables} deliverables
          {period ? ` · ${period}` : ""}
        </span>
      </div>
      {docBits.length > 0 ? <div className="text-[12.5px] text-muted-fg">{docBits.join(" · ")}</div> : null}
    </div>
  );
}

/**
 * Headline for duration mode and count-mode-without-deliverables — branches on
 * whether a budget is configured. (Unchanged from the pre-rate widget.)
 */
function Headline({ totals, headlineValue, budget, unit, period, mode }) {
  const isCountMode = mode === "count";
  const hasDowntime = totals.totalDowntime > 0;
  const secondary = isCountMode
    ? hasDowntime
      ? `MTTR ${Math.round(totals.mttr)}m · ${totals.totalDowntime}m total`
      : ""
    : `${totals.count} incident${totals.count === 1 ? "" : "s"}${
        totals.count > 0
          ? ` · MTTR ${Math.round(totals.mttr)}${unit === "minutes" ? "m" : ""}`
          : ""
      }`;

  if (Number.isFinite(budget) && budget > 0) {
    const pct = Math.min(100, Math.round((headlineValue / budget) * 100));
    const over = headlineValue > budget;
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <div
            className={cn(
              "text-[30px] font-extrabold leading-none tracking-[-0.04em] tabular-nums sm:text-[36px]",
              over ? "text-peach-ink" : "text-fg",
            )}
          >
            {headlineValue}
          </div>
          <span className="text-[13px] text-muted-fg">
            / {budget} {unit}
            {period ? ` · ${period}` : ""}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-card-alt">
          <div className={cn("h-full", over ? "bg-peach-ink" : "bg-ink")} style={{ width: `${pct}%` }} />
        </div>
        {secondary || over ? (
          <div className="text-[12.5px] text-muted-fg">
            {secondary}
            {over ? `${secondary ? " · " : ""}over budget` : ""}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <div className="text-[30px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg sm:text-[36px]">
          {isCountMode ? headlineValue : `Σ ${headlineValue}`}
        </div>
        <span className="text-[13px] text-muted-fg">{unit}</span>
      </div>
      {secondary ? <div className="text-[12.5px] text-muted-fg">{secondary}</div> : null}
    </div>
  );
}

function SeverityRow({ distribution }) {
  return (
    <div className="flex items-center gap-1.5">
      {distribution.map(([sev, count]) => (
        <Badge key={sev} tone={severityTone(sev)}>
          {sev} · {count}
        </Badge>
      ))}
    </div>
  );
}

/**
 * Tone helper — P1 reads as danger, P4 reads neutral. Maps severities onto
 * the tint system rather than a bespoke palette.
 */
function severityTone(sev) {
  switch (sev) {
    case "P1":
      return "peach";
    case "P2":
      return "lemon";
    case "P3":
      return "neutral";
    default:
      return "neutral";
  }
}

/* ────────────────────────── unit text helpers ────────────────────────── */

function pluralUnit(unit) {
  if (typeof unit !== "string" || !unit.trim()) return "incidents";
  const u = unit.trim();
  if (/s$/i.test(u)) return u;
  return `${u}s`;
}

function singularUnit(unit) {
  if (typeof unit !== "string" || !unit.trim()) return "incident";
  const u = unit.trim();
  if (/ies$/i.test(u)) return `${u.slice(0, -3)}y`;
  if (/s$/i.test(u)) return u.slice(0, -1);
  return u;
}

function capitalize(s) {
  if (typeof s !== "string" || !s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

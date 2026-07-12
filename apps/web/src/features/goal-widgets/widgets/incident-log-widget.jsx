"use client";

import { useMemo, useState } from "react";
import { WidgetShell } from "../widget-shell";
import { Select } from "@/components/ui";
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
          <RateHeadline
            rate={rate}
            defectCount={totals.count}
            deliverables={deliverables}
            totals={totals}
            period={period}
            variant={variant}
          />
        ) : (
          <Headline
            totals={totals}
            headlineValue={headlineValue}
            budget={target?.value}
            unit={unit}
            period={period}
            variant={variant}
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
            variant={variant}
            onCommit={(n) => append({ deliverables: n })}
          />
        ) : null}

        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color:
              variant === "light"
                ? "rgba(255,255,255,0.68)"
                : "var(--muted-fg)",
          }}
        >
          {spec.manual?.prompt ||
            (isCountMode
              ? `Log this ${singularUnit(unit)}: severity, root cause, corrective + preventive action.`
              : "Log this incident: severity, downtime, link.")}
        </div>

        {totals.bySeverity.length > 0 ? (
          <SeverityRow distribution={totals.bySeverity} variant={variant} />
        ) : null}

        {/* Input row. severity is a tight <select>; count mode adds the
            documentation fields the tier criteria grade against. Same min-w-0
            wrapping chain as the date-log widget so it never overflows. */}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Select
            tone={variant === "light" ? "inverse" : "default"}
            size="sm"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            aria-label="Severity"
          >
            {SEVERITY_LEVELS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <input
            type="number"
            min={0}
            value={downtime}
            onChange={(e) => setDowntime(e.target.value)}
            placeholder={isCountMode ? "min (opt)" : "min"}
            className="w-16 min-w-0 rounded-[var(--radius-sub)] bg-transparent px-2 py-1.5 outline-none"
            style={inputStyle(variant)}
            aria-label={
              isCountMode ? "Duration (optional, minutes)" : "Downtime (minutes)"
            }
          />
          <input
            value={rca}
            onChange={(e) => setRca(e.target.value)}
            placeholder={isCountMode ? "root cause" : "post-mortem (optional)"}
            className="min-w-0 flex-1 rounded-[var(--radius-sub)] bg-transparent px-2 py-1.5 outline-none"
            style={inputStyle(variant)}
            aria-label={isCountMode ? "Root-cause analysis" : "Post-mortem link"}
          />
          {isCountMode ? (
            <>
              <input
                value={action}
                onChange={(e) => setAction(e.target.value)}
                placeholder="corrective / preventive action"
                className="min-w-0 flex-1 rounded-[var(--radius-sub)] bg-transparent px-2 py-1.5 outline-none"
                style={inputStyle(variant)}
                aria-label="Corrective and preventive action"
              />
              <button
                type="button"
                onClick={() => setPreventiveClosed((v) => !v)}
                className="shrink-0 rounded-full px-2 py-1 uppercase tracking-[0.4px] transition-colors"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9.5,
                  border:
                    variant === "light"
                      ? "1px solid rgba(255,255,255,0.35)"
                      : "1px solid var(--border-strong)",
                  background: preventiveClosed
                    ? variant === "light"
                      ? "rgba(255,255,255,0.9)"
                      : "var(--accent-2)"
                    : "transparent",
                  color: preventiveClosed
                    ? variant === "light"
                      ? "var(--accent)"
                      : "#04140d"
                    : variant === "light"
                      ? "rgba(255,255,255,0.8)"
                      : "var(--muted-fg)",
                }}
                aria-pressed={preventiveClosed}
                title="Mark the preventive action as closed (done) vs open"
              >
                {preventiveClosed ? "prev ✓" : "prev …"}
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={logIncident}
            disabled={!minutesValid}
            className="shrink-0 rounded-[var(--radius-sub)] px-3 py-1.5 font-bold uppercase transition-opacity disabled:opacity-40"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              letterSpacing: "0.4px",
              background: variant === "light" ? "#ffffff" : "var(--accent)",
              color: variant === "light" ? "var(--accent)" : "var(--accent-on)",
            }}
          >
            Log
          </button>
        </div>

        <ul
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1"
          style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          {allDefects
            .slice()
            .reverse()
            .map((e) => {
              const v = e.value || {};
              const rcaText = v.rca || v.link || "";
              const rcaIsLink = /^https?:\/\//i.test(rcaText);
              return (
                <li
                  key={e.ts}
                  className="group flex items-center gap-2 rounded-[var(--radius-sub)] px-1.5 py-1"
                  style={{
                    background:
                      variant === "light"
                        ? "rgba(255,255,255,0.06)"
                        : "var(--card-alt)",
                  }}
                >
                  <span className="shrink-0 font-semibold">{fullDate(e.ts)}</span>
                  <span
                    className="shrink-0 rounded-full px-1.5 py-0.5"
                    style={{
                      fontSize: 9,
                      letterSpacing: "0.4px",
                      background: severityTone(v.severity, variant).background,
                      color: severityTone(v.severity, variant).color,
                    }}
                  >
                    {v.severity || "—"}
                  </span>
                  {Number.isFinite(v.downtime) ? (
                    <span
                      style={{
                        color:
                          variant === "light"
                            ? "rgba(255,255,255,0.85)"
                            : "var(--fg)",
                      }}
                    >
                      {v.downtime}m
                    </span>
                  ) : null}
                  {isCountMode ? (
                    <DocMarkers v={v} variant={variant} />
                  ) : null}
                  {rcaText ? (
                    rcaIsLink ? (
                      <a
                        href={rcaText}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 flex-1 truncate underline-offset-2 hover:underline"
                        style={{ color: mutedText(variant) }}
                        title={rcaText}
                      >
                        {isCountMode ? "root cause ↗" : "post-mortem ↗"}
                      </a>
                    ) : (
                      <span
                        className="min-w-0 flex-1 truncate"
                        style={{ color: mutedText(variant) }}
                        title={rcaText}
                      >
                        {rcaText}
                      </span>
                    )
                  ) : (
                    <span className="flex-1" />
                  )}
                  <button
                    type="button"
                    onClick={() => remove(e.ts)}
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    style={{
                      fontSize: 10,
                      color:
                        variant === "light"
                          ? "rgba(255,255,255,0.5)"
                          : "var(--dim-fg)",
                    }}
                    aria-label="Remove"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
        </ul>
      </div>
    </WidgetShell>
  );
}

/* ────────────────────────── inputs / styling ────────────────────────── */

function inputStyle(variant) {
  return {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: variant === "light" ? "#ffffff" : "var(--fg)",
    border:
      variant === "light"
        ? "1px solid rgba(255,255,255,0.22)"
        : "1px solid var(--border-strong)",
  };
}

function mutedText(variant) {
  return variant === "light" ? "rgba(255,255,255,0.7)" : "var(--muted-fg)";
}

/**
 * The rate denominator. A number the user maintains per period; committing on
 * blur / Enter appends a `{ deliverables }` entry (last write wins in-window).
 * Seeded from the stored value so it reflects what's persisted.
 */
function DeliverablesField({ deliverables, period, variant, onCommit }) {
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
    <label
      className="flex items-center gap-1.5"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        color: variant === "light" ? "rgba(255,255,255,0.72)" : "var(--muted-fg)",
      }}
    >
      <span className="uppercase tracking-[0.4px]">
        Deliverables{period ? ` this ${period}` : ""}
      </span>
      <input
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
        className="w-16 min-w-0 rounded-[var(--radius-sub)] bg-transparent px-2 py-1 outline-none"
        style={inputStyle(variant)}
        aria-label="Deliverables shipped this period"
      />
    </label>
  );
}

/** Compact per-defect documentation markers in the log row. */
function DocMarkers({ v, variant }) {
  const on = variant === "light" ? "rgba(255,255,255,0.85)" : "var(--fg)";
  const off = variant === "light" ? "rgba(255,255,255,0.3)" : "var(--dim-fg)";
  const hasRca = !!(v.rca || v.link);
  const hasAction = !!v.action;
  const prevClosed = v.preventive === "closed";
  return (
    <span
      className="shrink-0"
      style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.3px" }}
      title={`root cause: ${hasRca ? "yes" : "no"} · corrective action: ${
        hasAction ? "yes" : "no"
      } · preventive: ${v.preventive || "—"}`}
    >
      <span style={{ color: hasRca ? on : off }}>RCA</span>
      <span style={{ color: off }}> · </span>
      <span style={{ color: hasAction ? on : off }}>ACT</span>
      <span style={{ color: off }}> · </span>
      <span style={{ color: prevClosed ? on : off }}>
        {prevClosed ? "PREV✓" : "PREV"}
      </span>
    </span>
  );
}

/* ────────────────────────── headlines ────────────────────────── */

/**
 * Defect-rate headline (count mode, deliverables known). Rate is the big
 * number; the sub-lines carry the denominator + documentation coverage so the
 * tile reads the same story the grader sees.
 */
function RateHeadline({ rate, defectCount, deliverables, totals, period, variant }) {
  const muted = variant === "light" ? "rgba(255,255,255,0.72)" : "var(--muted-fg)";
  const monoStyle = {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: muted,
    lineHeight: 1.4,
  };
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
        <div
          className="font-semibold leading-none"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 40,
            letterSpacing: "-1.4px",
          }}
        >
          {rate}%
        </div>
        <div style={monoStyle}>
          defect rate · {defectCount} / {deliverables} deliverables
          {period ? ` · ${period}` : ""}
        </div>
      </div>
      {docBits.length > 0 ? <div style={monoStyle}>{docBits.join(" · ")}</div> : null}
    </div>
  );
}

/**
 * Headline for duration mode and count-mode-without-deliverables — branches on
 * whether a budget is configured. (Unchanged from the pre-rate widget.)
 */
function Headline({ totals, headlineValue, budget, unit, period, variant, mode }) {
  const muted =
    variant === "light" ? "rgba(255,255,255,0.72)" : "var(--muted-fg)";
  const monoStyle = {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: muted,
    lineHeight: 1.4,
  };
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
            className="font-semibold leading-none"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 40,
              letterSpacing: "-1.4px",
              color: over
                ? variant === "light"
                  ? "#ffd5d5"
                  : "var(--danger)"
                : "inherit",
            }}
          >
            {headlineValue}
          </div>
          <div style={monoStyle}>
            / {budget} {unit}
            {period ? ` · ${period}` : ""}
          </div>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full"
          style={{
            background:
              variant === "light" ? "rgba(255,255,255,0.18)" : "var(--border)",
          }}
        >
          <div
            className="h-full"
            style={{
              width: `${pct}%`,
              background: over
                ? variant === "light"
                  ? "#ffd5d5"
                  : "var(--danger)"
                : variant === "light"
                  ? "#ffffff"
                  : "var(--accent)",
            }}
          />
        </div>
        {secondary || over ? (
          <div style={monoStyle}>
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
        <div
          className="font-semibold leading-none"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 40,
            letterSpacing: "-1.4px",
          }}
        >
          {isCountMode ? headlineValue : `Σ ${headlineValue}`}
        </div>
        <div style={monoStyle}>{unit}</div>
      </div>
      {secondary ? <div style={monoStyle}>{secondary}</div> : null}
    </div>
  );
}

function SeverityRow({ distribution, variant }) {
  return (
    <div
      className="flex items-center gap-1.5"
      style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
    >
      {distribution.map(([sev, count]) => {
        const tone = severityTone(sev, variant);
        return (
          <span
            key={sev}
            className="rounded-full px-1.5 py-0.5"
            style={{
              background: tone.background,
              color: tone.color,
              letterSpacing: "0.4px",
            }}
          >
            {sev} · {count}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Tone helper — P1 reads warm/red, P4 cool/muted. Shared between the inline log
 * row and the distribution strip; light + dark variants each get a palette so
 * contrast stays readable.
 */
function severityTone(sev, variant) {
  const light = variant === "light";
  switch (sev) {
    case "P1":
      return {
        background: light ? "rgba(255,180,180,0.35)" : "rgba(220,80,80,0.18)",
        color: light ? "#ffe1e1" : "#e08585",
      };
    case "P2":
      return {
        background: light ? "rgba(255,210,150,0.32)" : "rgba(220,150,80,0.18)",
        color: light ? "#ffead0" : "#e0b075",
      };
    case "P3":
      return {
        background: light ? "rgba(220,220,220,0.28)" : "rgba(160,160,160,0.18)",
        color: light ? "rgba(255,255,255,0.85)" : "var(--muted-fg)",
      };
    default:
      return {
        background: light ? "rgba(255,255,255,0.14)" : "rgba(200,200,200,0.1)",
        color: light ? "rgba(255,255,255,0.7)" : "var(--dim-fg)",
      };
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

"use client";

/**
 * CadenceStepper — a per-widget gauge of the goal's cycle windows.
 *
 * Phase 1: READ-ONLY. Shows, for a manual widget, whether each cadence window
 * in the review cycle was filled — doubling as a status gauge and (later) the
 * check-in surface. Three adaptive modes from `buildCycleWindows`:
 *   - pip      non-bucketing / no cadence → complete ↔ incomplete
 *   - stepper  ≤13 windows (quarterly = 4, monthly = 12) — labelled cells
 *   - heatmap  many windows (weekly ≈ 52, daily ≈ 365) — compact grid
 *
 * Rendered once per tile from <WidgetShell> for MANUAL-variant widgets. Future
 * phases make cells selectable (pick a window to fill/backfill) and fold in
 * goal-locks "settled" state — at which point this replaces the /checkin page.
 *
 * State is never colour-only (a11y): each cell carries shape + glyph + a
 * `title` tooltip (`Q2 · current`). `prefers-reduced-motion` is respected by
 * using no animation at all here.
 *
 * NESTED CADENCES. A COMPOSED period can itself frame a whole second cadence
 * (`period.nested` — see composed-widget.jsx's header comment for the full
 * design). Opening a period whose resolved content carries `.nested` shows a
 * SECOND, recursive stepper (<NestedStepperLevel>) inside that period's editor
 * panel, bounded to that period's own [start,end) unless the nested block
 * authors its own explicit cycleStart/cycleEnd. Grading (useGoalTier, the
 * "Save & grade" action) stays a TOP-LEVEL-ONLY concern — a nested level's
 * fields are already live-persisted the instant they're typed (ComposedFields
 * writes on every change), so there is nothing for a nested "save" to do
 * beyond closing back up to the level above it.
 */

import { useMemo, useState } from "react";
import {
  useGoalInputs,
  buildCycleWindows,
  composedCycleBounds,
} from "@/features/goal-inputs";
import { GoalManualEditor, isInlineFillable } from "@/features/goal-editors";
import {
  SPEC_KINDS,
  specCadence,
  isSingleRecordWidget,
  resolvePeriodContent,
  resolveNestedPeriodContent,
} from "@/features/goal-specs";
import { isLocked, setLock, useGoalLocks } from "@/features/goal-locks";
import { useGoalTier, useGoalWindowTier, TIER_LABELS } from "@/features/goal-tiers";
import { ComposedFields } from "./widgets/composed-fields.jsx";

/** Mirrors the shared validator's COMPOSED_MAX_NEST_DEPTH — a safety ceiling. */
const MAX_NEST_DEPTH = 8;

const STATE_LABEL = {
  filled: "filled",
  owed: "not logged",
  current: "current",
  future: "upcoming",
  settled: "nothing to report",
};

function palette(variant) {
  const light = variant === "light";
  return {
    label: light ? "rgba(255,255,255,0.68)" : "var(--muted-fg)",
    dim: light ? "rgba(255,255,255,0.45)" : "var(--dim-fg)",
    filledBg: light ? "rgba(255,255,255,0.92)" : "var(--accent)",
    filledFg: light ? "#1d4ed8" : "var(--accent-on)",
    currentBorder: light ? "#ffffff" : "var(--accent)",
    currentBg: light ? "rgba(255,255,255,0.16)" : "var(--accent-dim)",
    currentFg: light ? "#ffffff" : "var(--accent)",
    owedBorder: light ? "rgba(255,255,255,0.55)" : "var(--border)",
    owedDot: light ? "rgba(255,255,255,0.85)" : "var(--muted-fg)",
    futureBorder: light ? "rgba(255,255,255,0.22)" : "var(--border)",
  };
}

function Check({ size = 15, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function cellVisual(state, p) {
  switch (state) {
    case "filled":
      return { background: p.filledBg, border: "none", glyph: <Check color={p.filledFg} /> };
    case "current":
      return {
        background: p.currentBg,
        border: `2px solid ${p.currentBorder}`,
        glyph: (
          <span style={{ color: p.currentFg, fontSize: 16, lineHeight: 1 }}>+</span>
        ),
      };
    case "settled":
      return {
        background:
          "repeating-linear-gradient(45deg, rgba(128,128,128,0.18), rgba(128,128,128,0.18) 3px, transparent 3px, transparent 6px)",
        border: `1px solid ${p.futureBorder}`,
        glyph: <span style={{ color: p.dim, fontSize: 13 }}>–</span>,
      };
    case "owed":
      return {
        background: "transparent",
        border: `1.5px dashed ${p.owedBorder}`,
        glyph: <span style={{ width: 5, height: 5, borderRadius: "50%", background: p.owedDot }} />,
      };
    default: // future
      return { background: "transparent", border: `1px solid ${p.futureBorder}`, glyph: null, faint: true };
  }
}

/**
 * The header + selectable grid (heatmap or stepper cells) for one cadence
 * level. Shared between the top-level stepper and every nested level so the
 * two don't drift into two different rendering rules for the same states.
 * Does NOT render the editor panel below it — each caller owns that, since
 * what goes in it (grading controls vs. not) differs by level.
 */
function WindowsGrid({ goalId, data, variant, fillable, selectedKey, onSelect }) {
  const p = palette(variant);
  const windows = data.windows || [];
  const settledOf = (w) =>
    isLocked(goalId, w.key) && w.state !== "filled" && w.state !== "future";

  const header = (
    <div className="mb-1.5 flex items-center justify-between" style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: p.label }}>
      <span style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>{data.cadence} · cycle</span>
      <span>{data.filledCount}/{data.total} filled</span>
    </div>
  );

  if (data.mode === "heatmap") {
    return (
      <>
        {header}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(11px, 1fr))", gap: 3 }}>
          {windows.map((w) => {
            const effState = settledOf(w) ? "settled" : w.state;
            const v = cellVisual(effState, p);
            const isSelected = w.key === selectedKey;
            const canFill = fillable && w.state !== "future";
            const cellStyle = {
              aspectRatio: "1 / 1",
              width: "100%",
              borderRadius: 2,
              background: v.background,
              border: v.border,
              opacity: v.faint ? 0.5 : 1,
              boxShadow: isSelected ? `0 0 0 2px ${p.currentBorder}` : "none",
              padding: 0,
            };
            return canFill ? (
              <button
                key={w.key}
                type="button"
                onClick={() => onSelect(isSelected ? null : w.key)}
                aria-pressed={isSelected}
                aria-label={`${isSelected ? "Close" : "Log"} ${w.label} (${STATE_LABEL[effState]})`}
                title={`${w.label} · ${STATE_LABEL[effState]}`}
                style={{ ...cellStyle, cursor: "pointer" }}
              />
            ) : (
              <div key={w.key} title={`${w.label} · ${STATE_LABEL[effState]}`} style={cellStyle} />
            );
          })}
        </div>
      </>
    );
  }

  // stepper
  return (
    <>
      {header}
      <div className="flex items-start gap-1.5">
        {windows.map((w) => {
          const settled = settledOf(w);
          const effState = settled ? "settled" : w.state;
          const v = cellVisual(effState, p);
          const isCurrent = w.state === "current";
          const isSelected = w.key === selectedKey;
          const canFill = fillable && w.state !== "future";
          const sz = isCurrent ? 40 : 34;
          const cell = (
            <div
              title={`${w.label} · ${STATE_LABEL[effState]}`}
              style={{
                width: "100%",
                maxWidth: sz + 8,
                height: sz,
                borderRadius: 8,
                background: v.background,
                border: v.border,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: v.faint ? 0.45 : 1,
                boxShadow: isSelected
                  ? `0 0 0 2px ${p.currentBorder}`
                  : isCurrent
                    ? `0 0 0 3px ${p.currentBg}`
                    : "none",
              }}
            >
              {v.glyph}
            </div>
          );
          return (
            <div key={w.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              {canFill ? (
                <button
                  type="button"
                  onClick={() => onSelect(isSelected ? null : w.key)}
                  aria-pressed={isSelected}
                  aria-label={`${isSelected ? "Close" : "Log"} ${w.label} (${STATE_LABEL[w.state]})`}
                  style={{ width: "100%", maxWidth: sz + 8, padding: 0, border: "none", background: "transparent", cursor: "pointer" }}
                >
                  {cell}
                </button>
              ) : (
                cell
              )}
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 8.5,
                  color: isCurrent || isSelected ? p.currentFg : p.dim,
                  fontWeight: isCurrent || isSelected ? 500 : 400,
                }}
              >
                {w.label}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * One NESTED cadence level — a selected period's `.nested` block. Its own
 * pip/heatmap/stepper, its own selection state, bounded to the containing
 * window's [start,end) unless it authors its own explicit cycle bounds.
 *
 * No grading controls here (see module header) — just settle/reopen (keyed by
 * the full compound periodKey, same mechanism as the top level) and close.
 */
function NestedStepperLevel({
  goalId,
  entries,
  composedBlock,
  periodKeyPrefix,
  fallbackStart,
  fallbackEnd,
  variant,
  fillable,
  depth,
}) {
  const [selectedKey, setSelectedKey] = useState(null);
  const cadence = composedBlock?.cadence || null;
  const explicitBounds = useMemo(
    () => composedCycleBounds({ composed: composedBlock }),
    [composedBlock],
  );
  const cycleStart = explicitBounds.cycleStart ?? fallbackStart ?? undefined;
  const cycleEnd = explicitBounds.cycleEnd ?? fallbackEnd ?? undefined;
  const hasBounds = cycleStart != null && cycleEnd != null;

  const data = useMemo(
    () =>
      buildCycleWindows({
        entries,
        cadence,
        now: Date.now(),
        ...(hasBounds ? { cycleStart, cycleEnd } : {}),
      }),
    [entries, cadence, cycleStart, cycleEnd, hasBounds],
  );

  if (!cadence || data.mode === "pip" || depth > MAX_NEST_DEPTH) return null;

  const windows = data.windows || [];
  const selectedIndex = selectedKey ? windows.findIndex((w) => w.key === selectedKey) : -1;
  const selected = selectedIndex >= 0 ? windows[selectedIndex] : null;
  const selectedPeriod = selected
    ? resolveNestedPeriodContent(composedBlock, selectedIndex)
    : null;
  const fullSelectedKey = selected ? `${periodKeyPrefix}::${selected.key}` : null;

  const editorPanel = selected ? (
    <div
      className="mt-2 rounded-[var(--radius-sub)] p-2.5"
      style={{ background: "var(--card)", color: "var(--fg)", border: "1px solid var(--border)" }}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--muted-fg)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          logging {selectedPeriod?.authored && selectedPeriod.label ? selectedPeriod.label : selected.label}
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setLock(goalId, fullSelectedKey, !isLocked(goalId, fullSelectedKey))}
            style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--muted-fg)", border: "none", background: "transparent", cursor: "pointer" }}
            title="Settle this period — nothing happened, stop flagging it as owed"
          >
            {isLocked(goalId, fullSelectedKey) ? "reopen" : "nothing to report"}
          </button>
          <button
            type="button"
            onClick={() => setSelectedKey(null)}
            style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--muted-fg)", border: "none", background: "transparent", cursor: "pointer" }}
          >
            close
          </button>
        </div>
      </div>
      {selectedPeriod?.authored && selectedPeriod.prompt ? (
        <div className="mb-2" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted-fg)", lineHeight: 1.5 }}>
          {selectedPeriod.prompt}
          {selectedPeriod.dueAt ? ` · due ${selectedPeriod.dueAt}` : ""}
        </div>
      ) : null}
      {selectedPeriod?.fields?.length > 0 ? (
        <ComposedFields
          goalId={goalId}
          fields={selectedPeriod.fields}
          periodKey={fullSelectedKey}
          writeTs={Math.floor((selected.start + selected.end) / 2)}
          variant="dark"
        />
      ) : null}
      {selectedPeriod?.nested ? (
        <NestedStepperLevel
          goalId={goalId}
          entries={entries}
          composedBlock={selectedPeriod.nested}
          periodKeyPrefix={fullSelectedKey}
          fallbackStart={selected.start}
          fallbackEnd={selected.end}
          variant={variant}
          fillable={fillable}
          depth={depth + 1}
        />
      ) : null}
    </div>
  ) : null;

  return (
    <div className="mt-3" style={{ borderTop: "1px dashed var(--border)", paddingTop: 10 }}>
      <WindowsGrid
        goalId={goalId}
        data={data}
        variant={variant}
        fillable={fillable}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
      />
      {editorPanel}
    </div>
  );
}

const WINDOW_TIER_COLOR = {
  not_achieved: "#b91c1c",
  achieved: "#1D4ED8",
  over_achieved: "#00c48a",
  role_model: "#f59e0b",
};

/**
 * This ONE window's own achievement tier — same criteria as the whole-goal
 * ladder (section 01), graded against only this window's data. On demand
 * only: no cached verdict shows "not graded yet" with a "grade this window"
 * button, rather than auto-grading the moment the fields are filled.
 */
function WindowTierPanel({ goalId, spec, periodKey, windowStart, windowEnd, variant }) {
  const { hasTiers, verdict, grading, grade } = useGoalWindowTier(
    goalId,
    spec,
    periodKey,
    windowStart,
    windowEnd,
  );
  if (!hasTiers) return null;
  const isLight = variant === "light";
  const muted = isLight ? "rgba(255,255,255,0.62)" : "var(--muted-fg)";
  const fg = isLight ? "#ffffff" : "var(--fg)";
  const color = verdict?.tier ? WINDOW_TIER_COLOR[verdict.tier] : muted;

  return (
    <div
      className="mt-2 flex items-center justify-between gap-2 border-t pt-2"
      style={{ borderColor: isLight ? "rgba(255,255,255,0.15)" : "var(--border)" }}
    >
      <div className="min-w-0">
        <span
          className="uppercase tracking-[0.5px]"
          style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: muted }}
        >
          This window&apos;s tier —{" "}
        </span>
        {verdict?.tier ? (
          <span
            className="font-bold uppercase"
            style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color }}
            title={verdict.reasoning || ""}
          >
            {TIER_LABELS[verdict.tier]}
          </span>
        ) : (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: muted }}>
            not graded yet
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={grade}
        disabled={grading}
        className="shrink-0 uppercase tracking-[0.5px] hover:opacity-100 disabled:opacity-40"
        style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: fg, opacity: 0.8 }}
        title="Grade this window against the tier criteria"
      >
        {grading ? "grading…" : verdict?.tier ? "re-grade window" : "grade window"}
      </button>
    </div>
  );
}

export function CadenceStepper({ spec, variant = "light" }) {
  const goalId = spec?.goalId;
  const { entries } = useGoalInputs(goalId);
  // Single-record kinds (MILESTONE / BEFORE_AFTER) render as one completion pip
  // by forcing a null cadence into buildCycleWindows — no per-window cells, so
  // no shadowed-backfill toggle. A one-time checklist / measurement pair has no
  // per-period state; its editor keeps a single latest-wins record that a
  // backfill write into a past window can never surface (the reported bug). The
  // Intelligence Hub's deriveGoalHealth applies the identical treatment so both
  // surfaces agree. RECURRING_MILESTONE / COMPOSED are genuinely per-period.
  const cadence = isSingleRecordWidget(spec?.widget) ? null : specCadence(spec);
  // Inline-fillable: the shared check-in editors, plus COMPOSED (which fills
  // per-period via its own <ComposedFields> body).
  const isComposed = spec?.widget === SPEC_KINDS.COMPOSED;
  const fillable = isInlineFillable(spec?.widget) || isComposed;
  const goal = useMemo(() => ({ id: goalId, title: spec?.title }), [goalId, spec?.title]);
  // Which window the user opened to fill/backfill (null = none; current period
  // is filled via the widget body above, as before).
  const [selectedKey, setSelectedKey] = useState(null);
  // Subscribe to lock changes so "nothing to report" settles re-render the cells.
  useGoalLocks();

  // Force a re-grade when the user finishes filling a window. Filling already
  // appends live, so the deterministic/AI grade re-runs on its own when the
  // cache key busts — but an AI call can be stale (or never fired if the
  // provider was down), so the explicit "Save & grade" button forces it.
  const { regrade, hasTiers } = useGoalTier(goalId, spec);
  function saveAndGrade() {
    // Qualitative widgets (spec.tiers) re-run the AI grader; numeric/tierScale
    // widgets re-grade deterministically off the data change on close.
    if (spec?.tiers) regrade?.();
    setSelectedKey(null);
  }

  const data = useMemo(
    () => buildCycleWindows({ entries, cadence, now: Date.now(), ...composedCycleBounds(spec) }),
    [entries, cadence, spec],
  );

  const p = palette(variant);

  if (data.mode === "pip") {
    const done = data.complete;
    return (
      <div className="mt-3 flex items-center gap-2" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: p.label }}>
        <span
          title={done ? "complete" : "not complete"}
          style={{
            width: 18,
            height: 18,
            borderRadius: "50%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: done ? p.filledBg : "transparent",
            border: done ? "none" : `1.5px dashed ${p.owedBorder}`,
          }}
        >
          {done ? <Check size={12} color={p.filledFg} /> : null}
        </span>
        {done ? "complete" : "not completed yet"}
      </div>
    );
  }

  const windows = data.windows || [];
  const selectedIndex = selectedKey
    ? windows.findIndex((w) => w.key === selectedKey)
    : -1;
  const selected = selectedIndex >= 0 ? windows[selectedIndex] : null;
  // Per-period content, if the spec authored any. Positional: window i is
  // period i, the same alignment the widget body uses.
  const selectedPeriod = selected ? resolvePeriodContent(spec, selectedIndex) : null;

  const editorPanel = selected ? (
    <div
      className="mt-2 rounded-[var(--radius-sub)] p-2.5"
      style={{ background: "var(--card)", color: "var(--fg)", border: "1px solid var(--border)" }}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--muted-fg)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          logging {selectedPeriod?.authored && selectedPeriod.label
            ? selectedPeriod.label
            : selected.label}
        </span>
        <div className="flex items-center gap-3">
          {/* "Nothing to report" settle — the same goal-locks escape hatch the
              check-in had, so a quiet period stops reading as owed. */}
          <button
            type="button"
            onClick={() => setLock(goalId, selected.key, !isLocked(goalId, selected.key))}
            style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--muted-fg)", border: "none", background: "transparent", cursor: "pointer" }}
            title="Settle this period — nothing happened, stop flagging it as owed"
          >
            {isLocked(goalId, selected.key) ? "reopen" : "nothing to report"}
          </button>
          <button
            type="button"
            onClick={() => setSelectedKey(null)}
            style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--muted-fg)", border: "none", background: "transparent", cursor: "pointer" }}
          >
            close
          </button>
          {/* Primary action — commit + re-grade. Highlighted (accent) so it
              reads as the affirmative step after filling the period. */}
          <button
            type="button"
            onClick={saveAndGrade}
            className="uppercase transition-[filter] hover:brightness-110"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: "0.5px",
              color: "var(--accent-on)",
              background: "var(--accent)",
              border: "1px solid var(--accent)",
              borderRadius: "var(--radius-sub)",
              padding: "4px 10px",
              cursor: "pointer",
            }}
            title={hasTiers ? "Save this period and re-grade the goal" : "Save this period"}
          >
            {hasTiers ? "Save & grade" : "Save"}
          </button>
        </div>
      </div>
      {isComposed ? (
        <>
          {/* What this specific period was for. Only rendered when the spec
              authored it — a uniform tracker has nothing extra to say. */}
          {selectedPeriod?.authored && selectedPeriod.prompt ? (
            <div
              className="mb-2"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--muted-fg)",
                lineHeight: 1.5,
              }}
            >
              {selectedPeriod.prompt}
              {selectedPeriod.dueAt ? ` · due ${selectedPeriod.dueAt}` : ""}
            </div>
          ) : null}
          <ComposedFields
            goalId={goalId}
            fields={selectedPeriod?.fields ?? spec.fields}
            periodKey={selected.key}
            writeTs={Math.floor((selected.start + selected.end) / 2)}
            variant="dark"
          />
          {selectedPeriod?.nested ? (
            <NestedStepperLevel
              goalId={goalId}
              entries={entries}
              composedBlock={selectedPeriod.nested}
              periodKeyPrefix={selected.key}
              fallbackStart={selected.start}
              fallbackEnd={selected.end}
              variant="dark"
              fillable={fillable}
              depth={1}
            />
          ) : null}
        </>
      ) : (
        <GoalManualEditor
          widget={spec.widget}
          goal={goal}
          spec={spec}
          weekStart={new Date(selected.start)}
          weekEnd={new Date(selected.end)}
          activeLabel={selected.label}
          writeTs={Math.floor((selected.start + selected.end) / 2)}
        />
      )}
      {spec?.tiers ? (
        <WindowTierPanel
          goalId={goalId}
          spec={spec}
          periodKey={selected.key}
          windowStart={selected.start}
          windowEnd={selected.end}
          variant="dark"
        />
      ) : null}
    </div>
  ) : null;

  return (
    <div className="mt-3">
      <WindowsGrid
        goalId={goalId}
        data={data}
        variant={variant}
        fillable={fillable}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
      />
      {editorPanel}
    </div>
  );
}

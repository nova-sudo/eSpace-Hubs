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
 * Every cell carries an aria-label + `title` tooltip naming its state, so the
 * state is never color-only even though the visual language (FillStrip's
 * filled/owed/current/future/settled palette) leans on color first.
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

import { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button, Label } from "@/components/ui";
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
import {
  useGoalTier,
  useGoalWindowTier,
  TIER_ORDER,
  TIER_LABELS,
  TIER_FIELD,
  TIER_COLOR,
  useTierFillFeedback,
} from "@/features/goal-tiers";
import { ComposedFields } from "./widgets/composed-fields.jsx";
import { PeriodDetail } from "./period-detail.jsx";
import { EvidenceAttachments } from "./evidence-attachments.jsx";

/** Mirrors the shared validator's COMPOSED_MAX_NEST_DEPTH — a safety ceiling. */
const MAX_NEST_DEPTH = 8;

const STATE_LABEL = {
  filled: "filled",
  owed: "not logged",
  current: "current",
  future: "upcoming",
  settled: "nothing to report",
};

// One place to translate a window's state into the FillStrip visual
// language — filled = ink, owed = peach-ink at 55%, current = card-alt with
// a dashed dim outline (the ONE dashed exception in the app), future and
// settled = card-alt (settled dimmed).
const CURRENT_DASH = { border: "1.5px dashed var(--dim-fg)" };
function cellVisual(state) {
  switch (state) {
    case "filled":
      return { className: "bg-ink text-ink-on", style: undefined, glyph: <Check size={14} /> };
    case "owed":
      return { className: "bg-peach-ink opacity-55", style: undefined, glyph: null };
    case "current":
      return { className: "bg-card-alt text-fg", style: CURRENT_DASH, glyph: null };
    case "settled":
      return { className: "bg-card-alt text-dim-fg opacity-60", style: undefined, glyph: null };
    default: // future
      return { className: "bg-card-alt text-dim-fg", style: undefined, glyph: null };
  }
}

/**
 * The header + selectable grid (heatmap or stepper cells) for one cadence
 * level. Shared between the top-level stepper and every nested level so the
 * two don't drift into two different rendering rules for the same states.
 * Does NOT render the editor panel below it — each caller owns that, since
 * what goes in it (grading controls vs. not) differs by level.
 */
function WindowsGrid({ goalId, data, fillable, selectedKey, onSelect }) {
  const windows = data.windows || [];
  const settledOf = (w) =>
    isLocked(goalId, w.key) && w.state !== "filled" && w.state !== "future";

  const header = (
    <div className="mb-2.5 flex items-center justify-between gap-2">
      <Label>{data.cadence} cycle</Label>
      {/* "logged" not "filled": a window counts here as soon as an entry
          exists for it, whatever that entry contains. The tier grader
          separately reports how many periods have every required field,
          which is a smaller number — naming both "filled" made the two
          read as a contradiction. */}
      <Label title="A window counts as logged once it has an entry, whatever that entry contains.">
        {data.filledCount}/{data.total} logged
      </Label>
    </div>
  );

  if (data.mode === "heatmap") {
    return (
      <>
        {header}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(11px, 1fr))", gap: 3 }}>
          {windows.map((w) => {
            const effState = settledOf(w) ? "settled" : w.state;
            const v = cellVisual(effState);
            const isSelected = w.key === selectedKey;
            const canFill = fillable && w.state !== "future";
            const cellStyle = {
              aspectRatio: "1 / 1",
              width: "100%",
              borderRadius: 2,
              boxShadow: isSelected ? "0 0 0 2px var(--ink)" : "none",
              padding: 0,
              ...v.style,
            };
            return canFill ? (
              <button
                key={w.key}
                type="button"
                onClick={() => onSelect(isSelected ? null : w.key)}
                aria-pressed={isSelected}
                aria-label={`${isSelected ? "Close" : "Log"} ${w.label} (${STATE_LABEL[effState]})`}
                title={`${w.label} · ${STATE_LABEL[effState]}`}
                className={v.className}
                style={{ ...cellStyle, cursor: "pointer" }}
              />
            ) : (
              <div key={w.key} title={`${w.label} · ${STATE_LABEL[effState]}`} className={v.className} style={cellStyle} />
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
          const v = cellVisual(effState);
          const isCurrent = w.state === "current";
          const isSelected = w.key === selectedKey;
          const canFill = fillable && w.state !== "future";
          const sz = isCurrent ? 40 : 34;
          const cell = (
            <div
              title={`${w.label} · ${STATE_LABEL[effState]}`}
              className={`flex items-center justify-center rounded-[var(--radius-md)] ${v.className}`}
              style={{
                width: "100%",
                maxWidth: sz + 8,
                height: sz,
                boxShadow: isSelected ? "0 0 0 2px var(--ink)" : "none",
                ...v.style,
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
              <span className={`text-[11px] ${isCurrent || isSelected ? "font-bold text-fg" : "text-dim-fg"}`}>
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
    <div className="mt-3 flex flex-col gap-2.5 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-bold text-fg">
          Logging {selectedPeriod?.authored && selectedPeriod.label ? selectedPeriod.label : selected.label}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setLock(goalId, fullSelectedKey, !isLocked(goalId, fullSelectedKey))}
            title="Settle this period — nothing happened, stop flagging it as owed"
          >
            {isLocked(goalId, fullSelectedKey) ? "Reopen" : "Nothing to report"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedKey(null)}>
            Close
          </Button>
        </div>
      </div>
      {selectedPeriod?.authored && selectedPeriod.prompt ? (
        <div className="text-[12.5px] leading-[1.5] text-muted-fg">
          {selectedPeriod.prompt}
          {selectedPeriod.dueAt ? ` · due ${selectedPeriod.dueAt}` : ""}
        </div>
      ) : null}
      {/* Backfilling week 9 six weeks late is exactly when the plan's own
          words matter most — the brief travels with the window. */}
      <PeriodDetail detail={selectedPeriod?.detail} notes={selectedPeriod?.notes} />
      {selectedPeriod?.fields?.length > 0 ? (
        <ComposedFields
          goalId={goalId}
          fields={selectedPeriod.fields}
          periodKey={fullSelectedKey}
          writeTs={Math.floor((selected.start + selected.end) / 2)}
        />
      ) : null}
      <EvidenceAttachments goalId={goalId} periodKey={fullSelectedKey} />
      {selectedPeriod?.nested ? (
        <NestedStepperLevel
          goalId={goalId}
          entries={entries}
          composedBlock={selectedPeriod.nested}
          periodKeyPrefix={fullSelectedKey}
          fallbackStart={selected.start}
          fallbackEnd={selected.end}
          fillable={fillable}
          depth={depth + 1}
        />
      ) : null}
    </div>
  ) : null;

  return (
    <div className="mt-3 rounded-[var(--radius-lg)] bg-card-alt p-4.5">
      <WindowsGrid
        goalId={goalId}
        data={data}
        fillable={fillable}
        selectedKey={selectedKey}
        onSelect={selectWindow}
      />
      {editorPanel}
    </div>
  );
}

// #239: this used to duplicate the four tier hexes locally, drifting
// from the canonical map the badges use. One source: tier-colors.js.
const WINDOW_TIER_COLOR = TIER_COLOR;

/**
 * This ONE window's own achievement tier — same criteria as the whole-goal
 * ladder (section 01), graded against only this window's data. On demand
 * only: no cached verdict shows "not graded yet" with a "grade this window"
 * button, rather than auto-grading the moment the fields are filled.
 */
function WindowTierPanel({ goalId, spec, periodKey, windowStart, windowEnd }) {
  const { hasTiers, tiers, tierGoverned, verdict, grading, grade } = useGoalWindowTier(
    goalId,
    spec,
    periodKey,
    windowStart,
    windowEnd,
  );
  if (!hasTiers) return null;
  const color = verdict?.tier ? WINDOW_TIER_COLOR[verdict.tier] : "var(--muted-fg)";
  const current = verdict?.tier || null;
  const tierMap = tiers || {};

  return (
    <div className="mt-3 flex flex-col gap-2.5 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-[12px] font-semibold text-muted-fg">
          This window&apos;s tier{tierGoverned ? " (manager-governed)" : ""} —{" "}
          {verdict?.tier ? (
            <span className="font-bold" style={{ color }} title={verdict.reasoning || ""}>
              {TIER_LABELS[verdict.tier]}
            </span>
          ) : (
            <span>not graded yet</span>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={grade}
          disabled={grading}
          title="Grade this window against the tier criteria"
        >
          {grading ? "Grading…" : verdict?.tier ? "Re-grade window" : "Grade window"}
        </Button>
      </div>
      {/* The criteria themselves — what "over achieved" etc. actually MEAN for
          this window, visible before grading. Without this a dev filling the
          window had no way to know what they were being judged against until
          after clicking "grade window". */}
      <div className="flex flex-wrap gap-1.5">
        {TIER_ORDER.map((t) => {
          const criterion = tierMap[TIER_FIELD[t]];
          const isCurrent = t === current;
          const tColor = WINDOW_TIER_COLOR[t];
          return (
            <div
              key={t}
              className="min-w-[130px] flex-1 rounded-[var(--radius-md)] bg-card-alt p-2.5"
              style={{ opacity: isCurrent || !current ? 1 : 0.5 }}
            >
              <div className="text-[11px] font-bold" style={{ color: isCurrent ? tColor : "var(--muted-fg)" }}>
                {TIER_LABELS[t]}
              </div>
              <div className="mt-0.5 text-[11.5px] leading-[1.3]" style={{ color: isCurrent ? "var(--fg)" : "var(--muted-fg)" }}>
                {criterion || "—"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CadenceStepper({ spec, onEditingWindowChange }) {
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

  // F9 G1.1 — "Save & grade" is an EXPLICIT fill: bracket it with the
  // fill-feedback orchestrator instead of a bare regrade. The debounced
  // intent bypasses the daily throttle for qualitative goals (one grade
  // per burst) and lets the rung-move diff fire; numeric/tierScale
  // widgets re-derive deterministically on render, no AI call.
  const { hasTiers } = useGoalTier(goalId, spec);
  const { captureBefore, settleAfter } = useTierFillFeedback(goalId);
  function saveAndGrade() {
    captureBefore();
    settleAfter();
    setSelectedKey(null);
  }

  const data = useMemo(
    () => buildCycleWindows({ entries, cadence, now: Date.now(), ...composedCycleBounds(spec) }),
    [entries, cadence, spec],
  );

  // The window the cycle is in right now. It is the DEFAULT editing target:
  // the widget body above already fills it, so selecting it here means
  // "go back to the default" rather than opening a second editor for it.
  const currentWindow = useMemo(
    () => (data.windows || []).find((w) => w.state === "current") || null,
    [data],
  );
  const currentKey = currentWindow?.key ?? null;
  // True while the user is editing some OTHER window (a backfill). The shell
  // hides its own body for the duration so the two editors never stack.
  const editingOtherWindow = selectedKey != null && selectedKey !== currentKey;
  const notifyRef = useRef(onEditingWindowChange);
  notifyRef.current = onEditingWindowChange;
  useEffect(() => {
    notifyRef.current?.(editingOtherWindow);
  }, [editingOtherWindow]);
  useEffect(() => () => notifyRef.current?.(false), []);

  function selectWindow(key) {
    // Clicking the current window returns to the default body instead of
    // duplicating it in the panel.
    setSelectedKey(key === currentKey ? null : key);
  }

  if (data.mode === "pip") {
    const done = data.complete;
    return (
      <div className="mt-3 flex items-center gap-2 text-[12px] font-semibold text-muted-fg">
        <span
          title={done ? "complete" : "not complete"}
          className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full"
          style={done ? { background: "var(--ink)" } : CURRENT_DASH}
        >
          {done ? <Check size={12} className="text-ink-on" /> : null}
        </span>
        {done ? "Complete" : "Not completed yet"}
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
    <div className="mt-3 flex flex-col gap-2.5 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-bold text-fg">
          Logging {selectedPeriod?.authored && selectedPeriod.label
            ? selectedPeriod.label
            : selected.label}
        </span>
        <div className="flex items-center gap-1.5">
          {/* "Nothing to report" settle — the same goal-locks escape hatch the
              check-in had, so a quiet period stops reading as owed. */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setLock(goalId, selected.key, !isLocked(goalId, selected.key))}
            title="Settle this period — nothing happened, stop flagging it as owed"
          >
            {isLocked(goalId, selected.key) ? "Reopen" : "Nothing to report"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedKey(null)}>
            {currentWindow ? `Back to ${currentWindow.label}` : "Close"}
          </Button>
          {/* Primary action — commit + re-grade. The one ink button in this
              panel, so it reads as the affirmative step after filling the
              period. */}
          <Button
            type="button"
            variant="ink"
            size="sm"
            onClick={saveAndGrade}
            title={hasTiers ? "Save this period and re-grade the goal" : "Save this period"}
          >
            {hasTiers ? "Save & grade" : "Save"}
          </Button>
        </div>
      </div>
      {isComposed ? (
        <>
          {/* What this specific period was for. Only rendered when the spec
              authored it — a uniform tracker has nothing extra to say. */}
          {selectedPeriod?.authored && selectedPeriod.prompt ? (
            <div className="text-[12.5px] leading-[1.5] text-muted-fg">
              {selectedPeriod.prompt}
              {selectedPeriod.dueAt ? ` · due ${selectedPeriod.dueAt}` : ""}
            </div>
          ) : null}
          <PeriodDetail detail={selectedPeriod?.detail} notes={selectedPeriod?.notes} />
          <ComposedFields
            goalId={goalId}
            fields={selectedPeriod?.fields ?? spec.fields}
            periodKey={selected.key}
            writeTs={Math.floor((selected.start + selected.end) / 2)}
          />
          <EvidenceAttachments goalId={goalId} periodKey={selected.key} />
          {selectedPeriod?.nested ? (
            <NestedStepperLevel
              goalId={goalId}
              entries={entries}
              composedBlock={selectedPeriod.nested}
              periodKeyPrefix={selected.key}
              fallbackStart={selected.start}
              fallbackEnd={selected.end}
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
        />
      ) : null}
    </div>
  ) : null;

  return (
    <div className="mt-3 rounded-[var(--radius-lg)] bg-card-alt p-4.5">
      <WindowsGrid
        goalId={goalId}
        data={data}
        fillable={fillable}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
      />
      {editorPanel}
    </div>
  );
}

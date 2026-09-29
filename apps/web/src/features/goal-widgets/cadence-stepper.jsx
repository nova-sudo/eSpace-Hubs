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
 * filled/owed/current/future/settled/before palette) leans on color first.
 *
 * Weekly windows are Sunday-anchored work weeks labelled like the snapshot
 * store's weeks ("W39" = Sun 20 – Sat 26 Sep 2026). Windows that ended
 * before the tracker was created are "before": neutral, never nagged about,
 * left out of the "x/y logged" count — and still clickable to backfill.
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

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button, Label } from "@/components/ui";
import {
  useGoalInputs,
  buildCycleWindows,
  composedCycleBounds,
  WINDOW_STATE_LABEL,
  cadencePeriodWord,
  windowCellTitle,
  loggedSoFar,
  periodWords,
} from "@/features/goal-inputs";
import {
  DraftFlushProvider,
  GoalManualEditor,
  isInlineFillable,
  useDraftRegistry,
} from "@/features/goal-editors";
import {
  SPEC_KINDS,
  specCadence,
  isSingleRecordWidget,
  resolvePeriodContent,
  resolveNestedPeriodContent,
} from "@/features/goal-specs";
import { isLocked, setLock, useGoalLocks } from "@/features/goal-locks";
import { windowKeyAliases } from "@espace-devhub/shared/goal-specs";
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

// Window-state words and the before-tracker hint are shared with the flow
// strip and the fill strip (goal-inputs/window-vocab.js).
const STATE_LABEL = WINDOW_STATE_LABEL;
const cellTitle = windowCellTitle;

/** Every lock key that settles window `w` — its own key plus legacy aliases. */
function lockKeysOf(goalId, w, cycleKeys, cadence) {
  const keys = [w.key];
  for (const alias of windowKeyAliases(cadence, w, cycleKeys)) {
    if (isLocked(goalId, alias)) keys.push(alias);
  }
  return keys;
}

const SHORT_DATE = { month: "short", day: "numeric", timeZone: "UTC" };

/** "Sep 22–28" / "Sep 29 – Oct 5" for a [start, end) window. */
function windowRange(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "";
  const a = new Date(start);
  const b = new Date(end - 1);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
  if (a.getUTCDate() === b.getUTCDate() && sameMonth) return a.toLocaleDateString("en-US", SHORT_DATE);
  if (sameMonth) return `${a.toLocaleDateString("en-US", SHORT_DATE)}–${b.getUTCDate()}`;
  return `${a.toLocaleDateString("en-US", SHORT_DATE)} – ${b.toLocaleDateString("en-US", SHORT_DATE)}`;
}

// One place to translate a window's state into the FillStrip visual
// language — filled = ink, owed = peach-ink at 55%, current = card-alt with
// a dashed dim outline (the ONE dashed exception in the app), future and
// settled = card-alt (settled dimmed). The CURRENT window keeps its outline
// even once filled, so "which one is now" never disappears after logging.
const CURRENT_DASH = { border: "1.5px dashed var(--dim-fg)" };
const CURRENT_FILLED_RING = { boxShadow: "0 0 0 1.5px var(--card-alt), 0 0 0 3px var(--dim-fg)" };
function cellVisual(state, isCurrentPeriod = false) {
  switch (state) {
    case "filled":
      return {
        className: "bg-ink text-ink-on",
        style: isCurrentPeriod ? CURRENT_FILLED_RING : undefined,
        glyph: <Check size={14} />,
      };
    case "owed":
      // A glyph, not colour alone, says "missed".
      return {
        className: "bg-peach text-peach-ink ring-1 ring-inset ring-peach-text",
        style: undefined,
        glyph: <span aria-hidden className="text-[11px] font-extrabold leading-none">!</span>,
      };
    case "current":
      return { className: "bg-track text-fg", style: CURRENT_DASH, glyph: null };
    case "settled":
      return {
        className: "bg-track text-muted-fg opacity-60",
        style: isCurrentPeriod ? CURRENT_DASH : undefined,
        glyph: null,
      };
    case "before":
      // Neutral, and quieter than "upcoming": nothing was owed here.
      return { className: "bg-transparent text-muted-fg ring-1 ring-inset ring-field-line opacity-60", style: undefined, glyph: null };
    default: // future — outlined so it reads on a card at 3:1
      return { className: "bg-card text-muted-fg ring-1 ring-inset ring-field-line", style: undefined, glyph: null };
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
  const [showEarlier, setShowEarlier] = useState(false);
  const windows = data.windows || [];
  const cycleKeys = new Set(windows.map((w) => w.key));
  const settledOf = (w) =>
    w.state !== "filled" &&
    w.state !== "future" &&
    (w.state === "settled" || lockKeysOf(goalId, w, cycleKeys, data.cadence).some((k) => isLocked(goalId, k)));

  // Honest count: of the windows DUE so far (ended + counted, plus the
  // current one once it's logged), how many are logged. Never "6/19" where
  // 19 includes weeks that haven't happened yet.
  const logged = loggedSoFar(data) || { done: 0, due: 0 };
  const [periodOne, periodMany] = periodWords(data.cadence);
  const periodNoun = logged.due === 1 ? periodOne : periodMany;

  // Pre-tracker windows collapse behind ONE control instead of 40+ hidden
  // "Log Wnn (before this tracker)" tab stops. Filled/selected ones stay.
  const isHiddenBefore = (w) => w.state === "before" && !showEarlier && w.key !== selectedKey;
  const hiddenCount = windows.filter((w) => w.state === "before" && w.key !== selectedKey).length;
  const firstCounted = windows.find((w) => w.state !== "before");
  const visible = windows
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => !isHiddenBefore(w));

  const header = (
    <div className="mb-2.5 flex items-center justify-between gap-2">
      <Label>This cycle</Label>
      {/* "logged" not "filled": a window counts here as soon as an entry
          exists for it, whatever that entry contains. */}
      <Label title="Counts only the windows that were due so far. A window counts as logged once it has an entry, whatever that entry contains.">
        {logged.due > 0
          ? `${logged.done} of ${logged.due} ${periodNoun} logged`
          : `Nothing due yet`}
      </Label>
    </div>
  );

  const beforeControl =
    data.beforeCount > 0 && fillable ? (
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted-fg">
        <span>
          Started {firstCounted?.label ?? "recently"} · earlier {periodMany} can be backfilled
        </span>
        <button
          type="button"
          aria-expanded={showEarlier}
          onClick={() => setShowEarlier((v) => !v)}
          className="min-h-6 rounded-[var(--radius-pill)] px-1 font-bold text-fg hover:underline"
        >
          {showEarlier
            ? `Hide earlier ${periodMany}`
            : `Backfill earlier ${periodMany} (${hiddenCount})`}
        </button>
      </div>
    ) : data.beforeCount > 0 ? (
      <div className="mt-2 text-[12px] text-muted-fg">
        Started {firstCounted?.label ?? "recently"} · earlier {periodMany} aren&apos;t counted
      </div>
    ) : null;

  if (data.mode === "heatmap") {
    return (
      <>
        {header}
        {/* 24px hit targets (WCAG 2.5.8) around a 16px visual. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(24px, 1fr))", gap: 2 }}>
          {visible.map(({ w, i }) => {
            const effState = settledOf(w) ? "settled" : w.state;
            const isCurrentPeriod = i === data.currentIndex;
            const v = cellVisual(effState, isCurrentPeriod);
            const isSelected = w.key === selectedKey;
            const canFill = fillable && w.state !== "future";
            const visual = (
              <span
                aria-hidden
                className={`flex h-4 w-4 items-center justify-center rounded-[3px] ${v.className}`}
                style={{
                  ...v.style,
                  ...(isSelected ? { boxShadow: "0 0 0 2px var(--ink)" } : {}),
                }}
              >
                {effState === "owed" ? v.glyph : null}
              </span>
            );
            const box = "flex h-6 w-full items-center justify-center";
            return canFill ? (
              <button
                key={w.key}
                type="button"
                onClick={() => onSelect(isSelected ? null : w.key)}
                aria-pressed={isSelected}
                aria-label={`${isSelected ? "Close" : "Log"} ${w.label} (${STATE_LABEL[effState]})`}
                title={cellTitle(w, effState)}
                className={`${box} cursor-pointer rounded-[var(--radius-md)]`}
              >
                {visual}
              </button>
            ) : (
              <div key={w.key} title={cellTitle(w, effState)} className={box}>
                {visual}
              </div>
            );
          })}
        </div>
        {beforeControl}
      </>
    );
  }

  // stepper
  return (
    <>
      {header}
      <div className="flex items-start gap-1.5">
        {visible.map(({ w, i }) => {
          const settled = settledOf(w);
          const effState = settled ? "settled" : w.state;
          // Positional "contains now" — stays true after the window is filled.
          const isCurrent = i === data.currentIndex;
          const v = cellVisual(effState, isCurrent);
          const isSelected = w.key === selectedKey;
          const canFill = fillable && w.state !== "future";
          const sz = isCurrent ? 40 : 34;
          const cell = (
            <div
              title={cellTitle(w, effState, isCurrent)}
              className={`flex items-center justify-center rounded-[var(--radius-md)] ${v.className}`}
              style={{
                width: "100%",
                maxWidth: sz + 8,
                height: sz,
                ...v.style,
                ...(isSelected ? { boxShadow: "0 0 0 2px var(--ink)" } : {}),
              }}
            >
              {v.glyph}
            </div>
          );
          return (
            <div key={w.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              {/* Fixed-height slot so every label below sits on one baseline,
                  however tall the current window's cell is. */}
              <div className="flex h-10 w-full items-center justify-center">
                {canFill ? (
                  <button
                    type="button"
                    onClick={() => onSelect(isSelected ? null : w.key)}
                    aria-pressed={isSelected}
                    aria-label={`${isSelected ? "Close" : "Log"} ${w.label} (${STATE_LABEL[effState]})`}
                    className="flex w-full justify-center"
                    style={{ maxWidth: sz + 8, padding: 0, border: "none", background: "transparent", cursor: "pointer" }}
                  >
                    {cell}
                  </button>
                ) : (
                  cell
                )}
              </div>
              <span
                className={`h-4 text-[11px] leading-4 ${isCurrent || isSelected ? "font-bold text-fg" : "text-muted-fg"}`}
              >
                {w.label}
              </span>
            </div>
          );
        })}
      </div>
      {beforeControl}
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
  /* The positional address of this block, minus the window the user picks
     below — an auto field defined only here is invisible to the server
     without it (see resolveContentAtPath). */
  periodPathPrefix,
  fallbackStart,
  fallbackEnd,
  fillable,
  depth,
  /* The tracker's tracking start (epoch ms) — nested windows that ended
     before it are "before", same as the top level's. */
  trackingStart = null,
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
        trackingStart,
      }),
    [entries, cadence, cycleStart, cycleEnd, hasBounds, trackingStart],
  );

  if (!cadence || data.mode === "pip" || depth > MAX_NEST_DEPTH) return null;

  const windows = data.windows || [];
  const selectedIndex = selectedKey ? windows.findIndex((w) => w.key === selectedKey) : -1;
  const selected = selectedIndex >= 0 ? windows[selectedIndex] : null;
  const selectedPeriod = selected
    ? resolveNestedPeriodContent(composedBlock, selectedIndex)
    : null;
  const fullSelectedKey = selected ? `${periodKeyPrefix}::${selected.key}` : null;
  const fullSelectedPath = selected ? [...(periodPathPrefix || []), selectedIndex] : null;

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
          periodPath={fullSelectedPath}
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
          periodPathPrefix={fullSelectedPath}
          fallbackStart={selected.start}
          fallbackEnd={selected.end}
          fillable={fillable}
          depth={depth + 1}
          trackingStart={trackingStart}
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
  // `.text`: this label sits on a plain card, not on the tier's tint.
  const color = verdict?.tier ? WINDOW_TIER_COLOR[verdict.tier]?.text : "var(--muted-fg)";
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
          const tColor = WINDOW_TIER_COLOR[t]?.text;
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
  // Drafts held by the inline editors (free-text note, before/after pair).
  // The panel's Save flushes them; "Back" asks before dropping them.
  const drafts = useDraftRegistry();
  function saveAndGrade() {
    // A draft that fails validation (half a before/after pair, a rejected
    // note) is NOT saved — closing the panel would unmount the editor and
    // silently drop both the draft and its error. Stay open and put the
    // cursor where the problem is.
    const flushed = drafts.flushAll();
    if (!flushed.ok) {
      flushed.failed[0]?.focus?.();
      return;
    }
    captureBefore();
    settleAfter();
    setSelectedKey(null);
  }
  function closePanel() {
    if (
      drafts.anyDirty() &&
      typeof window !== "undefined" &&
      !window.confirm("You have an unsaved entry in this window. Discard it?")
    ) {
      return;
    }
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
  // Refreshed after commit, not during render (React Compiler refs rule).
  useLayoutEffect(() => {
    notifyRef.current = onEditingWindowChange;
  });
  useEffect(() => {
    notifyRef.current?.(editingOtherWindow);
  }, [editingOtherWindow]);
  useEffect(() => () => notifyRef.current?.(false), []);

  function selectWindow(key) {
    // Clicking the current window returns to the default body instead of
    // duplicating it in the panel. Leaving a window with a dirty draft asks
    // first, same as "Back".
    const next = key === currentKey ? null : key;
    if (next === selectedKey) return;
    if (
      selectedKey != null &&
      drafts.anyDirty() &&
      typeof window !== "undefined" &&
      !window.confirm("You have an unsaved entry in this window. Discard it?")
    ) {
      return;
    }
    setSelectedKey(next);
  }
  const periodWord = cadencePeriodWord(cadence);

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
  const selectedLockKeys = selected
    ? lockKeysOf(goalId, selected, new Set(windows.map((w) => w.key)), cadence)
    : [];
  const selectedLocked = selectedLockKeys.some((k) => isLocked(goalId, k));

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
            onClick={() => {
              // Reopen clears the window's own key AND any legacy alias lock
              // that settled it (see lockKeysOf).
              if (selectedLocked) for (const k of selectedLockKeys) setLock(goalId, k, false);
              else setLock(goalId, selected.key, true);
            }}
            title="Settle this period — nothing happened, stop flagging it as owed"
          >
            {selectedLocked ? "Reopen" : "Nothing to report"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={closePanel}>
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
            periodPath={[selectedIndex]}
            writeTs={Math.floor((selected.start + selected.end) / 2)}
          />
          <EvidenceAttachments goalId={goalId} periodKey={selected.key} />
          {selectedPeriod?.nested ? (
            <NestedStepperLevel
              goalId={goalId}
              entries={entries}
              composedBlock={selectedPeriod.nested}
              periodKeyPrefix={selected.key}
              periodPathPrefix={[selectedIndex]}
              fallbackStart={selected.start}
              fallbackEnd={selected.end}
              fillable={fillable}
              depth={1}
              trackingStart={data.trackingStart ?? null}
            />
          ) : null}
        </>
      ) : (
        // Keyed on the window so a half-typed draft never carries over into
        // the next window the user opens.
        <GoalManualEditor
          key={selected.key}
          widget={spec.widget}
          goal={goal}
          spec={spec}
          weekStart={new Date(selected.start)}
          weekEnd={new Date(selected.end)}
          activeLabel={selected.label}
          writeTs={Math.floor((selected.start + selected.end) / 2)}
          periodWord={periodWord}
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

  // Which window the body above is filling right now. Without this line a
  // user had to infer it from which cell was dashed.
  const loggingWindow = selected || currentWindow;
  const loggingHeader = loggingWindow ? (
    <div className="mb-2.5 flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
      <span className="font-bold text-fg">
        Logging: {loggingWindow.label}
        {windowRange(loggingWindow.start, loggingWindow.end)
          ? ` (${windowRange(loggingWindow.start, loggingWindow.end)})`
          : ""}
      </span>
      <span className="text-muted-fg">
        {selected && selected.key !== currentKey
          ? "backfilling a past window"
          : `the current ${periodWord}`}
      </span>
    </div>
  ) : null;

  return (
    <DraftFlushProvider registry={drafts}>
      <div className="mt-3 rounded-[var(--radius-lg)] bg-card-alt p-4.5">
        {loggingHeader}
        <WindowsGrid
          goalId={goalId}
          data={data}
          fillable={fillable}
          selectedKey={selectedKey}
          onSelect={selectWindow}
        />
        {editorPanel}
      </div>
    </DraftFlushProvider>
  );
}

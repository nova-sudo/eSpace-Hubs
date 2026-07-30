"use client";

/**
 * COMPOSED — the generative widget interpreter.
 *
 * Renders ANY widget described by a declarative `spec.fields[]` schema (see
 * docs/generative-widget.md). The classifier (or a human) invents the
 * *combination* of fields and the cadence; this one component renders it. No
 * code is generated or executed — a "new widget type" is just data, so it's
 * safe, gradeable, and survives without a build.
 *
 * Period-aware: storage is one entry per period — `{ periodKey, values,
 * evidence }`. This widget shows the CURRENT period; the cadence stepper lets
 * the user fill/backfill any period. Non-bucketing / cadence-less goals use a
 * single running record (periodKey null). Field rendering + read/write live in
 * the shared <ComposedFields> so the widget and the stepper stay identical.
 *
 * A spec may also carry `composed.periods[]` — per-period content for plans
 * where each period asks for something DIFFERENT (week 1 wants a team charter,
 * week 8 a spec template). Those entries annotate cycle windows positionally,
 * so the window index is what selects them; `buildCycleWindows` already hands
 * us that index, which keeps this widget and the stepper reading the same
 * period as the compliance math.
 *
 * NESTED CADENCES. A period may itself frame a whole second cadence living
 * INSIDE that one window — a quarter containing weeks, each with their own
 * form (`period.nested`, a full `composed` block; see resolveNestedPeriodContent
 * in @espace-devhub/shared/goal-specs). Recursive: a nested block can nest
 * again, arbitrarily deep. <NestedCadenceLevel> renders one level and renders
 * itself again for whatever the resolved period nests, so this component
 * doesn't need to know how deep a given spec actually goes.
 *
 * Storage for a nested level reuses the exact same `{periodKey, values,
 * evidence}` entry shape — no schema change. A nested level's periodKey is
 * the containing level's key plus its own, joined with "::" (e.g.
 * "2026-Q1::2026-W3"), which the calendar-derived key formats ("2026-Q1",
 * "2026-W5", …) never themselves contain, so it's an unambiguous separator.
 * Every existing consumer that matches entries by exact periodKey string
 * (the grader, Evidence, the manager projection) keeps working unmodified —
 * a nested entry is just an entry whose periodKey happens to be compound.
 *
 * Some fields answer themselves: a field carrying `source` is read from GitHub
 * or GitLab instead of typed (see <ComposedFields>). We say so above the fields
 * rather than leaving the user to infer it from a greyed-out box — "3 of these
 * read themselves" is the difference between a form that looks half-broken and
 * one that's doing work on your behalf.
 */

import { useEffect, useMemo } from "react";
import { WidgetShell } from "../widget-shell";
import {
  buildCycleWindows,
  composedCycleBounds,
  currentPeriodKey,
  deriveCycleEndIso,
} from "@/features/goal-inputs";
import { resolvePeriodContent, resolveNestedPeriodContent, saveSpec } from "@/features/goal-specs";
import { ComposedFields } from "./composed-fields.jsx";

/** Mirrors the shared validator's COMPOSED_MAX_NEST_DEPTH — a safety ceiling,
 * not a product limit, so a malformed spec can't recurse this component into
 * a stack overflow even if it somehow slipped past validation. */
const MAX_NEST_DEPTH = 8;

function autoFieldCount(fields) {
  return (Array.isArray(fields) ? fields : []).filter(
    (f) => f?.source && typeof f.source === "object" && f.source.query,
  ).length;
}

/**
 * This level's `{cycleStart, cycleEnd}` (epoch ms) plus the current window's
 * own bounds — the latter is what a nested child inherits as ITS fallback
 * when it doesn't author explicit dates of its own. One buildCycleWindows
 * call serves both the current-window index and its start/end, rather than
 * computing the cycle twice.
 */
function useLevelWindow(cadence, explicitBounds, fallbackStart, fallbackEnd) {
  const cycleStart = explicitBounds.cycleStart ?? fallbackStart ?? undefined;
  const cycleEnd = explicitBounds.cycleEnd ?? fallbackEnd ?? undefined;
  const hasBounds = cycleStart != null && cycleEnd != null;

  const cycle = useMemo(() => {
    if (!cadence) return null;
    return buildCycleWindows({
      entries: [],
      cadence,
      now: Date.now(),
      ...(hasBounds ? { cycleStart, cycleEnd } : {}),
    });
  }, [cadence, cycleStart, cycleEnd, hasBounds]);

  const windowIndex = cycle?.currentIndex ?? -1;
  const currentWindow = windowIndex >= 0 ? cycle?.windows?.[windowIndex] : null;
  const key = cadence
    ? currentPeriodKey(cadence, Date.now(), cycleStart, cycleEnd)
    : null;

  return {
    windowIndex,
    key,
    // This window's own [start,end) — handed to a nested child as its
    // fallback bounds when it has no explicit cycleStart/cycleEnd itself.
    windowStart: currentWindow?.start ?? null,
    windowEnd: currentWindow?.end ?? null,
  };
}

/**
 * One nested cadence level — a period's `nested` block. Resolves the current
 * window the same way the top level does, renders that window's own fields
 * (if it defines any) under a compound periodKey, and recurses into whatever
 * that window itself nests.
 *
 * `fallbackStart`/`fallbackEnd` (epoch ms) are the CONTAINING window's own
 * bounds — used only when this level authors no explicit cycleStart/cycleEnd
 * of its own, so a nested block doesn't need one just to inherit "whatever
 * window it lives inside of".
 */
function NestedCadenceLevel({
  goalId,
  composedBlock,
  periodKeyPrefix,
  fallbackStart,
  fallbackEnd,
  variant,
  depth,
}) {
  const cadence = composedBlock?.cadence || null;
  const explicitBounds = useMemo(
    () => composedCycleBounds({ composed: composedBlock }),
    [composedBlock],
  );
  const { windowIndex, key, windowStart, windowEnd } = useLevelWindow(
    cadence,
    explicitBounds,
    fallbackStart,
    fallbackEnd,
  );

  const period = useMemo(
    () => resolveNestedPeriodContent(composedBlock, windowIndex),
    [composedBlock, windowIndex],
  );

  const isLight = variant === "light";
  const muted = isLight ? "rgba(255,255,255,0.68)" : "var(--muted-fg)";

  // Nothing sane to render: no cadence, or the cycle can't resolve a key —
  // rather than guess, this level (and anything nested inside it) is skipped.
  if (!cadence || !key || depth > MAX_NEST_DEPTH) return null;

  const fullKey = periodKeyPrefix ? `${periodKeyPrefix}::${key}` : key;
  const fields = period.fields;
  const autoCount = autoFieldCount(fields);

  return (
    <div
      className="mt-3 flex flex-col gap-2"
      style={{ borderTop: `1px dashed ${isLight ? "rgba(255,255,255,0.22)" : "var(--border)"}`, paddingTop: 10 }}
    >
      {period.authored && period.label ? (
        <div
          className="flex flex-wrap items-baseline gap-x-2"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
        >
          <span style={{ color: isLight ? "#ffffff" : "var(--fg)", fontWeight: 700 }}>
            {period.label}
          </span>
          {period.dueAt ? <span style={{ color: muted }}>due {period.dueAt}</span> : null}
        </div>
      ) : null}
      {period.prompt ? (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: muted }}>
          {period.prompt}
          {autoCount > 0 ? (
            <span style={{ opacity: 0.85 }}>
              {" "}
              · {autoCount} read {autoCount === 1 ? "itself" : "themselves"} from your repos
            </span>
          ) : null}
        </div>
      ) : null}
      {fields.length > 0 ? (
        <ComposedFields
          goalId={goalId}
          fields={fields}
          periodKey={fullKey}
          variant={variant}
          showHeadline={false}
        />
      ) : null}
      {period.nested ? (
        <NestedCadenceLevel
          goalId={goalId}
          composedBlock={period.nested}
          periodKeyPrefix={fullKey}
          fallbackStart={windowStart}
          fallbackEnd={windowEnd}
          variant={variant}
          depth={depth + 1}
        />
      ) : null}
    </div>
  );
}

export function ComposedWidget({ spec, goal, variant = "light", className, onRetry }) {
  const cadence = spec.composed?.cadence || null;

  // Anchors the cycle to the plan's ACTUAL start/end when the spec carries
  // one (composed.cycleStart/cycleEnd) — otherwise {} and every call below
  // keeps defaulting to the calendar year of "now", exactly as before.
  const bounds = useMemo(() => composedCycleBounds(spec), [spec]);
  const { windowIndex, key: currentKey, windowStart, windowEnd } = useLevelWindow(
    cadence,
    bounds,
    null,
    null,
  );

  // Self-heal: a spec authored with periods[] but no cycle bounds (every
  // tracker composed before this existed) silently mis-anchors every window
  // to the calendar year — "week 13" lands in April instead of wherever the
  // plan's own 13th week actually falls. If the goal itself carries a real
  // start date, adopt it onto the spec once so buildCycleWindows/
  // currentPeriodKey (and the grader, reading the same composed.cycleStart/
  // cycleEnd) get it right from here on.
  //
  // Also RE-derives cycleEnd even when cycleStart is already set: an earlier
  // version of this self-heal borrowed the goal's own `dueDate` for the end,
  // which is the goal's overall due date, not the document's actual plan
  // length — a 13-week Q3 sub-plan inside a goal due a year out got stretched
  // into a 53-week cycle. Comparing against the value deriveCycleEndIso would
  // produce now (from periods.length, not the goal's date) both fixes that
  // for existing mis-anchored specs and keeps this a no-op once correct, so
  // it converges rather than looping.
  //
  // Top-level only: a nested block that authors no cycleStart/cycleEnd of its
  // own simply inherits its containing window's bounds at render time (see
  // NestedCadenceLevel) — correct behaviour, not a gap, so there's nothing to
  // self-heal there.
  useEffect(() => {
    const composed = spec?.composed;
    const periodCount = composed?.periods?.length || 0;
    if (periodCount === 0 || !composed?.cadence) return;
    // Last-resort anchor when the goal itself has no startDate (common —
    // many goals never get one): period 1's own authored `dueAt`, if the AI
    // gave it one. Not precise (a due date isn't a start date), but landing
    // period 1 in roughly the right week/month beats the calendar-year
    // default by every measure that matters here, and it needs no further
    // action from the user — a tracker composed before the AI knew about
    // cycleStart has no more precise anchor available to self-heal from.
    const cycleStart =
      composed.cycleStart || goal?.startDate || composed.periods[0]?.dueAt || null;
    if (!cycleStart) return;
    const cycleEnd = deriveCycleEndIso(cycleStart, composed.cadence, periodCount);
    if (!cycleEnd) return;
    if (composed.cycleStart === cycleStart && composed.cycleEnd === cycleEnd) return;
    saveSpec({ ...spec, composed: { ...composed, cycleStart, cycleEnd } });
  }, [spec, goal?.startDate]);

  const period = useMemo(
    () => resolvePeriodContent(spec, windowIndex),
    [spec, windowIndex],
  );
  const fields = period.fields;
  const promptCopy = period.prompt || "Track this goal's data below.";
  const autoCount = useMemo(() => autoFieldCount(fields), [fields]);

  const isLight = variant === "light";
  const muted = isLight ? "rgba(255,255,255,0.68)" : "var(--muted-fg)";

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={`Composed · ${cadence || "one-time"}`}
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col gap-2">
        {/* An authored period names what THIS window is for. Without it the
            user sees a generic prompt and has to remember which week of the
            plan they're in — the exact gap per-period content closes. */}
        {period.authored && period.label ? (
          <div
            className="flex flex-wrap items-baseline gap-x-2"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
          >
            <span style={{ color: isLight ? "#ffffff" : "var(--fg)", fontWeight: 700 }}>
              {period.label}
            </span>
            {period.dueAt ? (
              <span style={{ color: muted }}>due {period.dueAt}</span>
            ) : null}
          </div>
        ) : null}
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: muted }}>
          {promptCopy}
          {autoCount > 0 ? (
            <span style={{ opacity: 0.85 }}>
              {" "}
              · {autoCount} read {autoCount === 1 ? "itself" : "themselves"} from your repos
            </span>
          ) : null}
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <ComposedFields
            goalId={goal?.id}
            fields={fields}
            periodKey={currentKey}
            variant={variant}
          />
          {period.nested ? (
            <NestedCadenceLevel
              goalId={goal?.id}
              composedBlock={period.nested}
              periodKeyPrefix={currentKey}
              fallbackStart={windowStart}
              fallbackEnd={windowEnd}
              variant={variant}
              depth={1}
            />
          ) : null}
        </div>
      </div>
    </WidgetShell>
  );
}

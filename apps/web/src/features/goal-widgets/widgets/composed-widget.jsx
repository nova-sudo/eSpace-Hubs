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
import { resolvePeriodContent, saveSpec } from "@/features/goal-specs";
import { ComposedFields } from "./composed-fields.jsx";

export function ComposedWidget({ spec, goal, variant = "light", className, onRetry }) {
  const cadence = spec.composed?.cadence || null;

  // Anchors the cycle to the plan's ACTUAL start/end when the spec carries
  // one (composed.cycleStart/cycleEnd) — otherwise {} and every call below
  // keeps defaulting to the calendar year of "now", exactly as before.
  const bounds = useMemo(() => composedCycleBounds(spec), [spec]);

  const currentKey = useMemo(
    () => currentPeriodKey(cadence, Date.now(), bounds.cycleStart, bounds.cycleEnd),
    [cadence, bounds],
  );

  // Which window of the cycle "now" falls in — the index authored periods are
  // keyed by. Entries aren't needed to locate the window, only to colour it,
  // so this pass is cheap. -1 (no cadence / non-bucketing) resolves to the
  // flat spec content, which is exactly right for a one-time tracker.
  const windowIndex = useMemo(() => {
    if (!cadence) return -1;
    return buildCycleWindows({ entries: [], cadence, now: Date.now(), ...bounds })
      .currentIndex;
  }, [cadence, bounds]);

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

  const autoCount = useMemo(
    () =>
      (Array.isArray(fields) ? fields : []).filter(
        (f) => f?.source && typeof f.source === "object" && f.source.query,
      ).length,
    [fields],
  );

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
        </div>
      </div>
    </WidgetShell>
  );
}

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
import { buildCycleWindows, composedCycleBounds, currentPeriodKey } from "@/features/goal-inputs";
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
  // plan's own 13th week actually falls. If the goal itself carries real
  // dates, adopt them onto the spec once so buildCycleWindows/currentPeriodKey
  // (and the grader, which reads the same composed.cycleStart/cycleEnd) get
  // it right from here on. Guarded on cycleStart already being set, so this
  // fires at most once per spec and never fights an intentionally-authored
  // pair.
  useEffect(() => {
    if (!spec?.composed?.periods?.length) return;
    if (spec.composed.cycleStart) return;
    if (!goal?.startDate || !goal?.dueDate) return;
    saveSpec({
      ...spec,
      composed: { ...spec.composed, cycleStart: goal.startDate, cycleEnd: goal.dueDate },
    });
  }, [spec, goal?.startDate, goal?.dueDate]);

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

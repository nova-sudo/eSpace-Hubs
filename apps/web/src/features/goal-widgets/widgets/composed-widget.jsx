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
 */

import { useMemo } from "react";
import { WidgetShell } from "../widget-shell";
import { currentPeriodKey } from "@/features/goal-inputs";
import { ComposedFields } from "./composed-fields.jsx";

export function ComposedWidget({ spec, goal, variant = "light", className, onRetry }) {
  const fields = Array.isArray(spec.fields) ? spec.fields : [];
  const cadence = spec.composed?.cadence || null;
  const promptCopy = spec.composed?.prompt || "Track this goal's data below.";

  const currentKey = useMemo(
    () => currentPeriodKey(cadence, Date.now()),
    [cadence],
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
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: muted }}>
          {promptCopy}
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

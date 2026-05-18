"use client";

/**
 * <GoalWidget /> — the one component callers render for a classified goal.
 *
 *   <GoalWidget spec={spec} goal={goal} variant="light" onRetry={...} />
 *
 * Responsibilities:
 *   1. Walk the spec through the 3-state decision tree:
 *        a. spec.delegated?.delegated   → DelegatedCard
 *        b. spec.context?.required &&
 *           answers incomplete           → ContextCollector
 *        c. otherwise                    → the actual widget (from registry)
 *   2. Expose user overrides on every state:
 *        - "self-track"  toggles delegated back off
 *        - "edit truths" re-opens the ContextCollector over the widget
 *        - "mark delegated" flips delegated on for a tracked widget
 *   3. Wrap every final render in an error boundary so one bad widget
 *      doesn't cascade into the grid.
 *
 * No data fetching here, no UI chrome duplicated — shells and widgets
 * both use `<WidgetShell>` for the outer tile styling.
 */

import { useState } from "react";
import { WidgetErrorBoundary } from "./widget-error-boundary";
import { WidgetShell } from "./widget-shell";
import { WidgetControlsProvider } from "./widget-controls-context";
import { resolveWidget } from "./registry";
import { DelegatedCard } from "./state-shells/delegated-card";
import { UntrackableCard } from "./state-shells/untrackable-card";
import { ContextCollector } from "./state-shells/context-collector";
import { useIsContextComplete } from "@/features/goal-context";
import { saveSpec } from "@/features/goal-specs";

export function GoalWidget({ spec, goal, variant = "light", className, onRetry }) {
  // User override — force the collector to re-open even after answers exist.
  const [forceEditContext, setForceEditContext] = useState(false);

  const contextComplete = useIsContextComplete(spec);

  if (!spec) return null;

  // ── State 0 ── Untrackable: user or AI marked this goal as not
  // currently trackable. Takes precedence over delegation, context,
  // and the widget body — the reason is the whole story until the
  // user clicks "track it" to unflag.
  if (spec.untrackable) {
    return (
      <UntrackableCard
        spec={spec}
        goal={goal}
        variant={variant}
        className={className}
        onRetry={onRetry}
        onClearUntrackable={() => clearUntrackable(spec)}
      />
    );
  }

  // ── State A ── Delegated: goal is judged by someone else. No tracking.
  if (spec.delegated?.delegated) {
    return (
      <DelegatedCard
        spec={spec}
        goal={goal}
        variant={variant}
        className={className}
        onRetry={onRetry}
        onUnsetDelegation={() => toggleDelegated(spec, false)}
      />
    );
  }

  // ── State B ── Context required and not yet satisfied. Show collector.
  const needsContext =
    spec.context?.required &&
    (forceEditContext || !contextComplete);
  if (needsContext) {
    return (
      <ContextCollector
        spec={spec}
        goal={goal}
        variant={variant}
        className={className}
        onRetry={() => {
          setForceEditContext(false);
          onRetry?.();
        }}
        // Save → close the override and let the actual widget take
        // back the slot. Without this, after the user clicked
        // "edit truths" + "Save answers", the view stayed pinned to
        // the collector forever (forceEditContext=true had no exit
        // path), which made it look like Save did nothing AND made
        // the rubric widget's regrade button unreachable.
        onSaved={() => setForceEditContext(false)}
      />
    );
  }

  // ── State C ── Normal tracked widget.
  const def = resolveWidget(spec);
  if (!def) {
    return (
      <WidgetShell
        spec={spec}
        variant={variant}
        label="Unknown widget"
        title={goal?.title || spec.title}
        onRetry={onRetry}
        className={className}
      >
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            lineHeight: 1.5,
            color: variant === "light" ? "rgba(255,255,255,0.7)" : "var(--muted-fg)",
          }}
        >
          No widget registered for <strong>{spec.widget}</strong>. Re-analyze
          to let the AI pick a different classification.
        </div>
      </WidgetShell>
    );
  }

  const Widget = def.Component;
  // Inject the override controls via context so `<WidgetShell>` — used by
  // every widget — renders the chips without the widget needing to know.
  const controls = {
    onMarkDelegated: () => toggleDelegated(spec, true),
    onEditContext: spec.context?.questions?.length
      ? () => setForceEditContext(true)
      : null,
  };

  return (
    <WidgetErrorBoundary onRetry={onRetry}>
      <WidgetControlsProvider value={controls}>
        <Widget
          spec={spec}
          goal={goal}
          variant={variant}
          className={className}
          onRetry={onRetry}
        />
      </WidgetControlsProvider>
    </WidgetErrorBoundary>
  );
}

/**
 * Flip the `delegated` flag on a spec and persist. Keeps the AI's judge /
 * note intact when un-flagging so a later re-flag preserves context.
 */
function toggleDelegated(spec, value) {
  const next = {
    ...spec,
    delegated: {
      ...(spec.delegated || {}),
      delegated: value,
    },
  };
  saveSpec(next);
}

/**
 * Clear the `untrackable` flag from a spec and persist. The widget's
 * underlying choice (kept on the spec as `widget` + `source`/`manual`)
 * takes over the slot immediately. We null out the field rather than
 * deleting it so the change is unambiguous to the validator and to any
 * sync mirrors that compare keys.
 */
function clearUntrackable(spec) {
  saveSpec({ ...spec, untrackable: null });
}

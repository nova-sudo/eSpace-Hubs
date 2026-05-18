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
// Import directly (not via @/features/analyst) to keep the dep edge
// goal-widgets → analyst one-way at the module level. analyst-page.jsx
// pulls GoalWidgetsGrid from @/features/goal-widgets so taking the
// barrel path here would close a cycle; ES-module cycles often work
// but can hand back `undefined` to whichever side initialised first.
// reclassify-one-goal.js itself only depends on `./ai/analysis-events`,
// which is below both features in our dep graph.
import { reclassifyOneGoal } from "@/features/analyst/reclassify-one-goal";

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
        // Phase C: opt-in "Re-analyze with these answers". Send the
        // freshly-serialised Q/A pairs to the classifier and replace
        // this goal's spec with the new one — which may pick a
        // DIFFERENT widget if the user's definitions point elsewhere
        // (e.g. CODE_RUBRIC → LINKAGE when the user defined "quality"
        // as "PR closes a Jira ticket"). Errors propagate up to the
        // collector via the rejected promise so the inline banner
        // shows what went wrong.
        onReclassify={async (pairs) => {
          await runReclassify(spec, goal, pairs);
        }}
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

/**
 * Re-classify a single goal with the user's freshly-saved context
 * answers folded into the prompt. On success the new spec replaces
 * the existing one in the goal-specs store — which causes the
 * `<GoalWidget>` to re-render and the new widget body (possibly a
 * different widget kind) to take the slot.
 *
 * Implementation notes:
 *  - `useCallback` would be appropriate here if React lifted closures
 *    out of the JSX, but since the parent component already memoises
 *    the JSX via React's normal re-render path AND the underlying
 *    `reclassifyOneGoal` opens a one-shot fetch per call, a fresh
 *    arrow per render is fine — the user can only click the button
 *    after a network round-trip.
 *  - We deliberately DON'T merge the new spec on top of the old one
 *    (`{ ...oldSpec, ...newSpec }`) because the classifier may have
 *    changed widget + kind + source + manual + context together; a
 *    field-by-field merge would leave a half-old / half-new spec
 *    that violates the variant↔widget pairing the validator enforces.
 *    The classifier returns a complete spec; we save that.
 *  - The `goal.title` / `goal.rubric` / `goal.kind` fields are pulled
 *    from the goal prop the dashboard already passes in — same source
 *    of truth as the analyst's `flattenGoalsForClassification`.
 */
async function runReclassify(spec, goal, contextAnswers) {
  const result = await reclassifyOneGoal({
    goal: {
      id: spec.goalId,
      title: goal?.title || spec.title || "(untitled)",
      description: goal?.rubric || goal?.description || "",
      parentL1Title: goal?.parentL1Title,
      kind: goal?.kind || "L2",
    },
    contextAnswers,
  });
  saveSpec(result);
}

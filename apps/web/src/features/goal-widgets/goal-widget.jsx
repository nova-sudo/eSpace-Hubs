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
import { PendingApprovalCard } from "./state-shells/pending-approval-card";
import { UntrackableCard } from "./state-shells/untrackable-card";
import { ContextCollector } from "./state-shells/context-collector";
import { ComposeWidgetModal } from "./compose-widget-modal";
import { EditSetupModal } from "./edit-setup-modal";
import { useIsContextComplete, readContextFor } from "@/features/goal-context";
import { saveSpec } from "@/features/goal-specs";
import { clearGoalEntries } from "@/features/goal-inputs";
import { clearGoalLocks } from "@/features/goal-locks";
// analyst-page.jsx pulls GoalWidgetsGrid from @/features/goal-widgets, so
// these barrel imports close a goal-widgets ↔ analyst ES-module cycle.
// That's fine here: every one of these bindings is referenced at render /
// callback time (inside components/handlers), never at module-init time,
// so the cycle is fully resolved before any of them is read. Keep it that
// way — do NOT call these at the top level of this module.
import {
  reclassifyOneGoal,
  useAnalystOptional,
  ANALYST_MODES,
  stageSpecForReview,
} from "@/features/analyst";

export function GoalWidget({
  spec,
  goal,
  variant = "light",
  className,
  onRetry,
  // Embedders (e.g. the SCORECARD sub-component modal) can null out or
  // redirect controls that don't make sense in their context. Merged
  // over the derived State-C controls, so `{ onReanalyze: null }` hides
  // that chip without the widget files knowing.
  controlsOverride = null,
}) {
  // User override — force the collector to re-open even after answers exist.
  const [forceEditContext, setForceEditContext] = useState(false);
  // Pins the ContextCollector mounted while a re-analyze it owns is in flight.
  // Persisting answers flips contextComplete → true mid-await, which would
  // otherwise unmount the collector before its busy/error/onSaved sequence
  // completes — keeping it mounted closes that race for the multi-step wizard
  // and any stray blur.
  const [reanalyzing, setReanalyzing] = useState(false);
  // "Describe your own tracker" modal — the manual COMPOSED escape hatch.
  // Reachable from the ContextCollector (setup) and a mounted widget's
  // "build my own" control. Owned here so both states can open the same modal.
  const [composeOpen, setComposeOpen] = useState(false);
  // "Edit setup" modal — adjust targets / scorecard weights on the current
  // committed widget without re-running the AI.
  const [editSetupOpen, setEditSetupOpen] = useState(false);

  // Optional handle to the analyst overlay (null when there's no provider
  // above — e.g. an isolated render). Re-analyze uses it to open the
  // Review pane so the user vets the AI's proposal before it lands.
  const analyst = useAnalystOptional();

  const contextComplete = useIsContextComplete(spec);

  if (!spec) return null;

  const composeModal = (
    <ComposeWidgetModal
      open={composeOpen}
      onClose={() => setComposeOpen(false)}
      spec={spec}
      goal={goal}
      onSaved={() => {
        setComposeOpen(false);
        setForceEditContext(false);
      }}
    />
  );

  const editSetupModal = (
    <EditSetupModal
      open={editSetupOpen}
      onClose={() => setEditSetupOpen(false)}
      spec={spec}
      goal={goal}
      onSaved={() => setEditSetupOpen(false)}
    />
  );

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

  // ── State 0.5 ── Build-Your-Own tracker awaiting (or sent back by) manager
  // approval. Read-only until approved; "revise" re-opens the compose modal,
  // which resubmits it as pending.
  if (spec.approval?.status === "pending" || spec.approval?.status === "rejected") {
    return (
      <>
        <PendingApprovalCard
          spec={spec}
          goal={goal}
          variant={variant}
          className={className}
          onRetry={onRetry}
          onRevise={() => setComposeOpen(true)}
        />
        {composeModal}
      </>
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
    (forceEditContext || !contextComplete || reanalyzing);
  if (needsContext) {
    return (
      <>
      <ContextCollector
        spec={spec}
        goal={goal}
        variant={variant}
        className={className}
        onRetry={() => {
          setForceEditContext(false);
          onRetry?.();
        }}
        // Escape hatch: "none of these fit — describe your own tracker" opens
        // the COMPOSED compose modal instead of answering the setup questions.
        onCompose={() => setComposeOpen(true)}
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
          setReanalyzing(true);
          try {
            await runReclassify(spec, goal, pairs);
          } finally {
            setReanalyzing(false);
          }
        }}
      />
      {composeModal}
      </>
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
    // Re-analyze re-runs the classifier with the goal's full description +
    // saved context answers, then opens the analyst Review pane seeded with
    // the AI's proposal — the user vets targets / weights / scope and hits
    // Save before it replaces the committed widget (nothing changes until
    // they confirm; committing wipes history like any re-analysis). Falls
    // back to a direct save only when there's no <AnalystProvider> above.
    onReanalyze: async () => {
      const result = await reclassifyGoalToSpec(spec, goal);
      if (analyst?.requestOpen) {
        stageSpecForReview(result, {
          title: goal?.title || result.title,
          parentL1: goal?.parentL1Title,
        });
        analyst.requestOpen(ANALYST_MODES.REVIEW);
        return;
      }
      const saved = saveSpec(result);
      if (!saved?.ok) {
        // Surface the validation failure through WidgetShell's catch/toast
        // instead of silently swallowing it (this branch only runs when
        // there's no AnalystProvider — isolated renders / tests).
        throw new Error(
          (saved?.errors || []).join(", ") || "Re-classified spec was invalid.",
        );
      }
      clearGoalEntries(spec.goalId);
      clearGoalLocks(spec.goalId);
    },
    // "Build my own": open the COMPOSED compose modal to replace this widget
    // with a user-described tracker (for goals the classifier keeps mis-fitting).
    onComposeOwn: () => setComposeOpen(true),
    // "Edit setup": adjust this widget's targets / scorecard weights in place
    // — same widget, keeps history (no AI, no wipe).
    onEditSetup: () => setEditSetupOpen(true),
    // Embedder overrides (e.g. sub-component modal disables re-analyze).
    ...(controlsOverride || {}),
  };

  return (
    <>
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
      {composeModal}
      {editSetupModal}
    </>
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
async function reclassifyGoalToSpec(spec, goal, contextAnswers) {
  return reclassifyOneGoal({
    goal: {
      id: spec.goalId,
      title: goal?.title || spec.title || "(untitled)",
      // Ship the SAME rich description bulk analysis builds (Category /
      // Priority / Weightage / Window + Context + Rubric), not a bare
      // rubric — otherwise the model loses the signal it needs to
      // re-scope team-worded tiers down to the individual.
      description: buildReclassifyDescription(goal),
      parentL1Title: goal?.parentL1Title,
      kind: goal?.kind || "L2",
    },
    // Prefer freshly-edited pairs (from the ContextCollector); otherwise
    // read the goal's saved context answers so a per-widget re-analyze
    // still feeds the user's definitions to the classifier.
    contextAnswers: contextAnswers ?? savedContextPairs(spec),
  });
}

/**
 * ContextCollector path ("Re-analyze with these answers"): re-classify
 * and SAVE immediately. The user is mid-setup in the collector, so we
 * apply the new spec straight away rather than bouncing them into the
 * Review overlay. The mounted-widget "re-analyze" chip uses the review
 * flow instead (see GoalWidget's `onReanalyze`).
 */
async function runReclassify(spec, goal, contextAnswers) {
  const result = await reclassifyGoalToSpec(spec, goal, contextAnswers);
  const saved = saveSpec(result);
  // Re-analysis may have swapped the widget shape — wipe the goal's logged
  // history + settle-locks so the new widget reads clean, not stale entries
  // from the old one. Mirrors the analyst commit path (classify-run-store).
  if (saved?.ok) {
    clearGoalEntries(spec.goalId);
    clearGoalLocks(spec.goalId);
  }
}

/**
 * Build the rich, multi-section description the classifier expects —
 * mirrors the analyst's buildL2Description so a single-goal re-analyze
 * gets identical context to a full run. Inlined (not imported from the
 * analyst feature) to keep the goal-widgets → analyst dep edge one-way.
 */
function buildReclassifyDescription(goal) {
  if (!goal) return "";
  const window =
    goal.startDate || goal.dueDate
      ? `${goal.startDate || "?"} → ${goal.dueDate || "?"}`
      : "";
  const metaPairs = [
    ["Category", goal.category],
    ["Priority", goal.priority],
    ["Weightage", goal.weightage ? `${goal.weightage}%` : ""],
    ["Window", window],
  ]
    .map(([k, v]) => [k, typeof v === "string" ? v.trim() : v])
    .filter(([, v]) => v);
  const sections = [];
  if (metaPairs.length) sections.push(metaPairs.map(([k, v]) => `${k}: ${v}`).join("\n"));
  const ctx = typeof goal.description === "string" ? goal.description.trim() : "";
  if (ctx) sections.push(`Context:\n${ctx}`);
  const rubric = typeof goal.rubric === "string" ? goal.rubric.trim() : "";
  if (rubric) sections.push(`Rubric:\n${rubric}`);
  return sections.join("\n\n") || rubric || ctx || "";
}

/**
 * Serialise the goal's SAVED context answers into the {prompt, answer}
 * pairs the classifier prompt renders. Used when re-analyzing without the
 * ContextCollector open (the per-widget "re-analyze" chip) so the user's
 * previously-defined truths still reach the model. Returns [] when the
 * spec has no context questions.
 */
function savedContextPairs(spec) {
  const questions = spec?.context?.questions || [];
  if (!questions.length) return [];
  const answers = readContextFor(spec.goalId) || {};
  const out = [];
  for (const q of questions) {
    const raw = answers[q.id];
    let answer = "";
    if (q.kind === "list") {
      answer = Array.isArray(raw)
        ? raw.map((s) => String(s).trim()).filter(Boolean).join("\n")
        : "";
    } else if (q.kind === "number") {
      answer = typeof raw === "number" && !Number.isNaN(raw) ? String(raw) : "";
    } else {
      answer = typeof raw === "string" ? raw.trim() : "";
    }
    if (answer) out.push({ prompt: q.prompt, answer });
  }
  return out;
}

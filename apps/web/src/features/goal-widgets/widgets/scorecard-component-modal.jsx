"use client";

import { useEffect } from "react";
import { GoalWidget } from "../goal-widget";
import {
  buildSubSpec,
  seedRubricContextIfNeeded,
} from "./scorecard-subspec";

/**
 * Modal that opens when a SCORECARD ComponentRow is clicked.
 *
 * Renders the FULL widget body — CodeRubricWidget's criteria editor +
 * Grade button + PR list with verdicts; or INCIDENT_LOG's full
 * incident logger; etc. — instead of the compact summary that lives
 * in the row.
 *
 * Synthetic-spec strategy
 * ───────────────────────
 * We can't feed the component object directly to the widget Component
 * — the standalone widgets expect a full ValidatedSpec shape with
 * `goalId`, `title`, `context`, etc. So we synthesize one from the
 * parent spec + the component:
 *
 *   goalId       = `${parentSpec.goalId}::sc${componentIndex}`
 *   title        = component.label || pretty-printed widget kind
 *   widget/kind  = component.widget/kind
 *   source       = component.source
 *   manual       = component.manual
 *   context      = synthetic "quality-standards" question for
 *                  CODE_RUBRIC so the ContextCollector route works
 *   firstReviewOnly = component.firstReviewOnly
 *
 * The synthetic `goalId` is the same id the SCORECARD widget already
 * uses for MANUAL components' `useGoalInputs` and for `useGradedPrs`'s
 * `scopeKey`, so the data the user sees in the modal IS the data the
 * scorecard scored.
 *
 * CODE_RUBRIC criteria seeding
 * ────────────────────────────
 * The standalone CodeRubricWidget reads its rubric criteria from the
 * goal-context store keyed on `spec.goalId`. The scorecard editor
 * stores criteria on `component.manual.items`. To bridge: on first
 * modal mount we seed the synthetic goalId's context with the
 * component's items. From that point on the goal-context store is
 * authoritative — edits in the rubric widget land there, and the
 * SCORECARD's aggregate (see `useRubricForSlot`) also reads from
 * context, so changes round-trip without a second persistence step.
 *
 * Backdrop click + ESC close. Body click stops propagation so the
 * widget's own buttons keep working.
 */
export function ScorecardComponentModal({
  open,
  onClose,
  parentSpec,
  parentGoal,
  component,
  index,
}) {
  const subGoalId =
    parentSpec?.goalId && Number.isFinite(index)
      ? `${parentSpec.goalId}::sc${index}`
      : null;

  // Seed criteria for CODE_RUBRIC if context is empty for this sub-id.
  // Same helper the check-in surfaces use, so the modal and the
  // check-in always seed under identical rules.
  useEffect(() => {
    if (!open) return;
    if (!subGoalId) return;
    seedRubricContextIfNeeded(subGoalId, component);
  }, [open, subGoalId, component]);

  // ESC closes — bind globally for the duration the modal is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !component) return null;

  const syntheticSpec = buildSubSpec(parentSpec, component, index);
  const syntheticGoal = {
    ...(parentGoal || {}),
    id: subGoalId,
    title: syntheticSpec.title,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${syntheticSpec.title} — full view`}
      className="fixed inset-0 z-[120] flex items-center justify-center px-4 py-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{
        background: "rgba(10, 10, 20, 0.55)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-[680px] flex-col overflow-hidden rounded-[var(--radius-tile)]"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--accent)",
          color: "var(--accent-on)",
          boxShadow: "0 24px 72px rgba(0,0,0,0.35)",
        }}
      >
        <ModalHeader
          label={syntheticSpec.title}
          parentTitle={parentGoal?.title || parentSpec?.title}
          onClose={onClose}
        />
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* Route through GoalWidget rather than rendering the widget
              Component directly — GoalWidget handles the
              context-required → ContextCollector routing so a
              CODE_RUBRIC component with empty criteria walks the user
              through the same "define rubric" flow the standalone
              widget uses. State lives under the synthetic goalId so
              the SCORECARD's aggregate sees the edits immediately. */}
          <GoalWidget
            spec={syntheticSpec}
            goal={syntheticGoal}
            variant="light"
            onRetry={null}
            // This widget is SYNTHETIC — its goalId is `${parent}::sc${i}`,
            // not a real goal. Re-analyze / build-your-own / edit-setup /
            // delegate would all persist a bogus top-level spec under that
            // synthetic id (and never touch the real scorecard component).
            // Suppress them here; component setup is edited via the parent
            // SCORECARD tile's "edit setup" chip. "edit truths" stays so
            // CODE_RUBRIC criteria remain editable in this modal.
            controlsOverride={{
              onReanalyze: null,
              onComposeOwn: null,
              onEditSetup: null,
              onMarkDelegated: null,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function ModalHeader({ label, parentTitle, onClose }) {
  return (
    <div
      className="flex items-center justify-between border-b px-4 py-3"
      style={{ borderColor: "rgba(255,255,255,0.18)" }}
    >
      <div className="flex flex-col gap-0.5 truncate">
        {parentTitle ? (
          <span
            className="uppercase tracking-[0.5px]"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              color: "rgba(255,255,255,0.6)",
            }}
            title={parentTitle}
          >
            Scorecard · {truncate(parentTitle, 60)}
          </span>
        ) : null}
        <span
          className="font-semibold leading-none"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 18,
            letterSpacing: "-0.4px",
          }}
        >
          {label}
        </span>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="rounded-[var(--radius-sub)] px-2.5 py-1 transition-opacity hover:opacity-80"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.5px",
          background: "transparent",
          border: "1px solid rgba(255,255,255,0.35)",
          color: "rgba(255,255,255,0.95)",
        }}
      >
        ✕ ESC
      </button>
    </div>
  );
}

function truncate(s, max) {
  if (typeof s !== "string") return "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

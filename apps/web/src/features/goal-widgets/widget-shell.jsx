"use client";

/**
 * Shared tile chrome for every goal widget.
 *
 * `variant` is accepted for back-compat (callers still pass "light" / "dark"
 * from the analyst overlay vs. a regular tile) but no longer switches color
 * schemes — the redesign uses one card recipe everywhere and lets the
 * `--card` / `--fg` tokens handle light/dark automatically.
 *
 * Provides:
 *   - top row (kind/cadence label + optional right-side badge)
 *   - title (spec.title, denormalized)
 *   - reasoning disclosure (collapsed by default, toggleable)
 *   - cadence stepper (auto-rendered for a ready MANUAL widget)
 *   - provenance chip (F5 data-honesty line)
 *   - footer action row
 *
 * Widgets use this purely for layout — all data-specific rendering lives in
 * the widget component itself.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Label } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useWidgetControls } from "./widget-controls-context";
import { SPEC_KIND_META, SPEC_VARIANTS } from "@/features/goal-specs";
import { useIsContextComplete } from "@/features/goal-context";
import { CadenceStepper } from "./cadence-stepper";
import { isGoalReady } from "./readiness";
import { ProvenanceChip } from "./provenance-chip";

export function WidgetShell({
  spec,
  variant: _variant = "light",
  label,
  rightChip,
  title,
  footer,
  provenance,
  onRetry,
  className = "",
  style,
  children,
}) {
  const [showReason, setShowReason] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  // Set by <CadenceStepper> while a PAST window is open for backfill.
  const [editingWindow, setEditingWindow] = useState(false);
  // Optional user-controls injected by <GoalWidget>. Null handlers skip
  // rendering — widgets rendered outside the resolver (e.g. tests) still
  // work unchanged.
  const { onMarkDelegated, onEditContext, onReanalyze, onComposeOwn, onEditSetup, onEditPlan } =
    useWidgetControls();
  // Readiness gate for the cadence stepper. The state shells (ContextCollector
  // / Delegated / Untrackable) also render through WidgetShell, so gating the
  // stepper on widget-variant alone leaked it into the "define before tracking"
  // state. Only show the stepper once the goal is actually trackable.
  const contextComplete = useIsContextComplete(spec);

  // The footer "re-analyze" action. Prefer the injected onReanalyze
  // (GoalWidget): it re-runs the classifier and opens the analyst Review
  // pane seeded with the AI's proposal so the user vets targets/weights/
  // scope before it replaces the committed widget — with a busy state and
  // a success/failure toast. Falls back to onRetry (e.g. the analyst
  // overlay's own re-analyze) when no direct handler is wired.
  async function handleReanalyze() {
    if (reanalyzing) return;
    if (!onReanalyze) {
      onRetry?.();
      return;
    }
    setReanalyzing(true);
    try {
      await onReanalyze();
      toast.success("Re-analyzed — review & confirm the new setup.");
    } catch (err) {
      toast.error(`Re-analyze failed: ${err?.message || err}`);
    } finally {
      setReanalyzing(false);
    }
  }
  const canReanalyze = !!(onReanalyze || onRetry);

  return (
    <div
      className={`relative flex min-h-[180px] min-w-0 flex-col overflow-hidden rounded-[var(--radius-xl)] bg-card p-5 ${className}`}
      style={{ boxShadow: "var(--shadow-card)", ...style }}
    >
      {(label || rightChip) ? (
        <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
          <Label className="min-w-0 truncate" title={typeof label === "string" ? label : undefined}>
            {label}
          </Label>
          {rightChip ? <span className="shrink-0">{rightChip}</span> : null}
        </div>
      ) : null}

      {title ? (
        <div
          className="mb-1.5 text-[15px] font-bold leading-[1.3] text-fg"
          style={{
            // Long L2 titles (e.g. "Lead a weekly engineering knowledge-
            // share session") should wrap, not push the card wider.
            overflowWrap: "break-word",
            wordBreak: "normal",
            textWrap: "pretty",
          }}
          title={title}
        >
          {title}
        </div>
      ) : null}

      {/* The widget body fills the CURRENT window. While the stepper below is
          editing a past window, it is hidden rather than unmounted (so a
          half-typed current-period entry survives the detour) — the backfill
          editor replaces it instead of stacking under it. */}
      <div className={cn("flex min-h-0 flex-1 flex-col", editingWindow ? "hidden" : "")}>
        {children}
      </div>

      {/* Cadence stepper — per-window fill/status gauge for MANUAL widgets.
          Gated on the manual variant (so AUTO tiles don't mount the goal-inputs
          subscription) AND on readiness (so it never appears in the "define
          before tracking" / delegated / untrackable state shells). */}
      {spec &&
      SPEC_KIND_META[spec.widget]?.variant === SPEC_VARIANTS.MANUAL &&
      isGoalReady(spec, contextComplete) ? (
        <CadenceStepper spec={spec} onEditingWindowChange={setEditingWindow} />
      ) : null}

      {/* F5 data-honesty chip — what the number is made of + refresh.
          Sits ABOVE the footer controls so it reads as part of the data,
          not as another action chip. */}
      {provenance ? (
        <div className="mt-2 flex min-w-0">
          <ProvenanceChip provenance={provenance} />
        </div>
      ) : null}

      {(spec?.reasoning || onRetry || onReanalyze || footer || onMarkDelegated || onEditContext || onComposeOwn || onEditSetup || onEditPlan) ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {spec?.reasoning ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowReason((s) => !s)}
              >
                {showReason ? "Hide why" : "Why?"}
              </Button>
            ) : null}
            {onEditSetup ? (
              <Button type="button" variant="ghost" size="sm" onClick={onEditSetup}>
                Edit setup
              </Button>
            ) : null}
            {onEditPlan ? (
              <Button type="button" variant="ghost" size="sm" onClick={onEditPlan}>
                Edit plan
              </Button>
            ) : null}
            {onEditContext ? (
              <Button type="button" variant="ghost" size="sm" onClick={onEditContext}>
                Edit truths
              </Button>
            ) : null}
            {onMarkDelegated ? (
              <Button type="button" variant="ghost" size="sm" onClick={onMarkDelegated}>
                Delegate
              </Button>
            ) : null}
            {onComposeOwn ? (
              <Button type="button" variant="ghost" size="sm" onClick={onComposeOwn}>
                Build my own
              </Button>
            ) : null}
            {footer}
          </div>
          {canReanalyze ? (
            <Button type="button" variant="soft" size="sm" onClick={handleReanalyze}>
              {reanalyzing ? "Re-analyzing…" : "Re-analyze"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {showReason && spec?.reasoning ? (
        <div className="mt-2 rounded-[var(--radius-lg)] bg-card-alt p-3 text-[12.5px] leading-[1.45] text-muted-fg">
          {spec.reasoning}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Tiny helper component: the "target X" chip that auto widgets show when
 * a source has a target. Exported so widgets can opt-in inline. `variant`
 * is accepted for back-compat and unused — the badge tone carries the
 * meaning now.
 */
export function TargetChip({ target, unit, variant: _variant = "light" }) {
  if (!target) return null;
  return (
    <Badge tone="lav">
      Target {target.op} {target.value}
      {unit ? ` ${unit}` : ""}
    </Badge>
  );
}

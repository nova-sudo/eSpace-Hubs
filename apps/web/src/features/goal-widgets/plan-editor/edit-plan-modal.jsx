"use client";

/**
 * "Edit plan" modal — the bigger view for a LIVE COMPOSED tracker's plan:
 * fix the cycle (cadence / start / length), remap activities and
 * deliverables between windows, add or remove a nested cadence.
 *
 * Neighbours: "Edit setup" adjusts targets/weights and never touches the
 * cycle; "Build my own" re-runs the AI and replaces the widget. This one
 * keeps the same widget and its history, and saves WITHOUT `replace` (locked
 * tiers survive). Two honesty rules on save:
 *
 *   1. A STRUCTURAL change (cadence / start / length) re-keys the windows,
 *      so entries logged under the old keys may stop lining up. The modal
 *      says so above the buttons whenever the goal has entries — it doesn't
 *      block, because moving a plan that was wrongly anchored (the 53-week
 *      bug) is exactly the fix those entries need.
 *   2. A Build-Your-Own tracker went through manager approval. A structural
 *      change means the manager approved a different plan, so it goes back
 *      to pending and is resubmitted — same route the compose modal uses.
 *      Content-only edits (moving an activity a week later) keep approval.
 *
 * Host shell mirrors ComposeWidgetModal, widened: the plan is a list of up
 * to 53 windows with chips inside, and 560px turns that into a scroll of
 * wrapped pills.
 */

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { X } from "lucide-react";
import { saveSpec } from "@/features/goal-specs";
import { useGoalInputs } from "@/features/goal-inputs";
import { apiPost } from "@/lib/api-client";
import { Button, IconButton, Label, useFocusTrap } from "@/components/ui";
import { PlanEditor } from "./plan-editor";
import { isStructuralChange, resolvePlanBounds, stampBounds } from "./plan-model";

export function EditPlanModal({ open, onClose, spec, goal, onSaved }) {
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const trapRef = useFocusTrap(open && !!draft);
  const { entries } = useGoalInputs(spec?.goalId);

  // Seed on open, keyed on goalId (not the spec object) so a background SWR
  // revalidation mid-edit doesn't wipe the working copy.
  useEffect(() => {
    if (open) {
      setDraft(spec?.composed ? { ...spec.composed } : { cadence: "weekly" });
      setError(null);
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, spec?.goalId]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const goalTitle = useMemo(() => goal?.title || spec?.title || "this goal", [goal?.title, spec?.title]);
  const structural = useMemo(
    () => (draft && spec?.composed ? isStructuralChange(spec.composed, finalBlock(draft, goal)) : false),
    [draft, spec?.composed, goal],
  );
  const entryCount = Array.isArray(entries) ? entries.length : 0;

  if (!open || !draft) return null;
  if (typeof document === "undefined") return null;

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    const composed = finalBlock(draft, goal);
    const wasApproved = !!spec?.approval;
    const resubmit = wasApproved && structural;
    const next = {
      ...spec,
      composed,
      ...(resubmit ? { approval: { status: "pending", submittedAt: Date.now() } } : {}),
    };
    const result = saveSpec(next);
    if (!result.ok) {
      setSaving(false);
      setError(`Couldn't save the plan: ${(result.errors || []).join(", ") || "invalid spec"}`);
      return;
    }
    if (resubmit) {
      const r = await apiPost(`/goal-specs/${encodeURIComponent(spec.goalId)}/submit-approval`, {});
      const status = r.ok ? r.data?.status || "pending" : "pending";
      if (status === "approved") {
        saveSpec({ ...next, approval: { status: "approved" } });
        toast.success("Plan updated.", {
          description: r.data?.autoApproved ? "No manager on file, so it went live without a review." : undefined,
        });
      } else {
        toast.success("Plan updated and sent back to your manager.", {
          description: "The cycle changed, so it needs approving again.",
        });
      }
    } else {
      toast.success("Plan updated.");
    }
    setSaving(false);
    onSaved?.();
    onClose?.();
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit the plan"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      className="fixed inset-0 z-[130] flex items-center justify-center bg-fg/40 p-4"
    >
      <div
        ref={trapRef}
        className="flex max-h-[90vh] w-full max-w-[980px] flex-col overflow-hidden rounded-[var(--radius-xl)] bg-card"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <Label>Edit plan</Label>
            <div className="truncate text-[18px] font-bold tracking-[-0.01em] text-fg" title={goalTitle}>
              {goalTitle}
            </div>
          </div>
          <IconButton label="Close" onCard onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <PlanEditor block={draft} onChange={setDraft} goal={goal} />
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4">
          <div className="min-w-0 text-[12.5px] leading-[1.5]">
            {error ? (
              <span className="text-peach-ink">{error}</span>
            ) : structural && entryCount > 0 ? (
              <span className="text-lemon-ink">
                Changing the cadence, start or length re-keys the windows. {entryCount} logged{" "}
                {entryCount === 1 ? "entry" : "entries"} may stop lining up with them.
              </span>
            ) : structural && spec?.approval ? (
              <span className="text-muted-fg">The cycle changed, so this goes back to your manager for approval.</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" variant="ink" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save plan"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The block as it will be saved: the reviewed cycle stamped on explicitly. */
function finalBlock(draft, goal) {
  const bounds = resolvePlanBounds(draft, { goal });
  return bounds ? stampBounds(draft, bounds) : draft;
}

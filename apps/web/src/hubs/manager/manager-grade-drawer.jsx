"use client";

/**
 * Manager grading drawer — set the achievement tier on a report's goal.
 * Writes PUT /manager/reports/:userId/goals/:goalId/verdict, which
 * upserts the manager verdict (outranks the AI tier) and notifies the
 * report. Pre-fills the current tier; flags the AI's suggestion when the
 * goal was only AI-graded so far.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { X } from "lucide-react";
import { apiPut } from "@/lib/api-client";
import { TIER_ORDER, TIER_LABELS } from "@/features/goal-tiers";
import { Badge, Button, IconButton, Label, useFocusTrap } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useGoalDetail } from "./use-goal-detail";
import { ManagerGoalReview } from "./manager-goal-review";

const TIER_DESC = {
  not_achieved: "Below the agreed bar for the cycle.",
  achieved: "Met the expectation for the role.",
  over_achieved: "Clearly exceeded the target.",
  role_model: "Set the standard others should follow.",
};

// Ladder tone by tier — not achieved / achieved / exceeds / role model.
const TIER_TONE = {
  not_achieved: "peach",
  achieved: "mint",
  over_achieved: "sky",
  role_model: "lav",
};

const TONE_CLASSES = {
  peach: "bg-peach text-peach-ink",
  mint: "bg-mint text-mint-ink",
  sky: "bg-sky text-sky-ink",
  lav: "bg-lav text-lav-ink",
};

export function ManagerGradeDrawer({
  open,
  goal,
  userId,
  userName,
  onClose,
  onSaved,
}) {
  const [tier, setTier] = useState(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const trapRef = useFocusTrap(open && !!goal);

  // Read-only goal detail (definition, evidence, AI verdict) for the
  // review panel — fetched lazily while the drawer is open.
  const detail = useGoalDetail(userId, goal?.id, open);

  useEffect(() => {
    if (!open || !goal) return;
    setTier(goal.tier?.tier ?? null);
    setNote(goal.tier?.source === "manager" ? (goal.tier?.reasoning ?? "") : "");
    setSaving(false);
  }, [open, goal]);

  // #239: Escape closes (every other overlay in the app does), and the
  // element that opened the drawer gets focus back on close so keyboard
  // users aren't dropped at the top of the document.
  useEffect(() => {
    if (!open) return undefined;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [open, onClose]);

  // Lock body scroll while the drawer is open — it sits over the page,
  // not in the flow, so the page underneath shouldn't scroll.
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || !goal) return null;
  if (typeof document === "undefined") return null;

  const aiSuggested = goal.tier?.source === "ai" ? goal.tier.tier : null;
  const firstName = (userName || "They").split(" ")[0];

  async function save() {
    if (!tier) {
      toast.error("Pick a tier first");
      return;
    }
    setSaving(true);
    const r = await apiPut(
      `/manager/reports/${encodeURIComponent(userId)}/goals/${encodeURIComponent(
        goal.id,
      )}/verdict`,
      { tier, note },
    );
    setSaving(false);
    if (r.ok) {
      toast.success(`Graded · ${TIER_LABELS[tier]}`, {
        description: `${firstName} has been notified.`,
      });
      onSaved?.();
    } else {
      toast.error("Couldn't save the grade", {
        description: r.error?.message || "Try again in a moment.",
      });
    }
  }

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[60] bg-fg/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Grade ${goal.title}`}
        className="fixed right-0 top-0 z-[61] flex w-[min(600px,100vw)] flex-col bg-card rounded-l-[var(--radius-xl)]"
        style={{ height: "100dvh", boxShadow: "var(--shadow-float)" }}
      >
        <div className="flex items-start justify-between gap-3 px-6 py-5">
          <div className="min-w-0">
            <Label>Grade · achievement tier</Label>
            <h2 className="mt-2 text-[18px] font-bold tracking-[-0.01em]">
              {goal.title}
            </h2>
            <div className="mt-1.5 text-[12px] text-muted-fg">
              {firstName} · you set the final tier
            </div>
          </div>
          <IconButton label="Close" onCard onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Read-only GoalWidget view — leads with the AI grade + the
              engineer's evidence, then the criteria + definition. */}
          <ManagerGoalReview
            loading={detail.loading}
            error={detail.error}
            data={detail.data}
          />

          {/* Divider into the grading action itself. */}
          <div className="mb-3 mt-6">
            <Label>Set the tier</Label>
          </div>

          {aiSuggested ? (
            <p className="mb-3 text-[12px] leading-snug text-muted-fg">
              The AI suggests{" "}
              <b className="text-fg">{TIER_LABELS[aiSuggested]}</b>. Accept it
              or override — your grade is final.
            </p>
          ) : null}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {TIER_ORDER.map((t) => {
              const active = tier === t;
              const tone = TIER_TONE[t];
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTier(t)}
                  aria-pressed={active}
                  className={cn(
                    "relative rounded-[var(--radius-md)] p-3 text-left transition-colors",
                    active ? TONE_CLASSES[tone] : "bg-card-alt text-fg",
                  )}
                >
                  {aiSuggested === t ? (
                    <Badge tone="ink" className="absolute right-2 top-2">
                      AI
                    </Badge>
                  ) : null}
                  <span className="block text-[13px] font-bold">{TIER_LABELS[t]}</span>
                  <span
                    className={cn(
                      "mt-0.5 block text-[11px] leading-snug",
                      active ? "opacity-80" : "text-muted-fg",
                    )}
                  >
                    {TIER_DESC[t]}
                  </span>
                </button>
              );
            })}
          </div>

          <Label className="mt-5 block">
            Note to the engineer <span className="normal-case text-dim-fg">(optional)</span>
          </Label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What earned this tier? They'll see this with the grade."
            className="mt-2 w-full rounded-[var(--radius-lg)] bg-card-alt p-3.5 text-[13px] leading-relaxed outline-none focus:ring-2 focus:ring-ink"
            style={{ minHeight: 92, resize: "vertical" }}
          />
        </div>

        <div className="border-t border-line px-6 py-4">
          <div className="mb-2.5 text-[11.5px] text-muted-fg">
            {firstName} will be notified and can see your note.
          </div>
          <div className="flex gap-2.5">
            <Button type="button" variant="soft" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="ink"
              className="flex-[2]"
              onClick={save}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save grade"}
            </Button>
          </div>
        </div>
      </aside>
    </>,
    document.body,
  );
}

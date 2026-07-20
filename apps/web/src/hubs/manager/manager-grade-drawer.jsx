"use client";

/**
 * Manager grading drawer — set the achievement tier on a report's goal.
 * Writes PUT /manager/reports/:userId/goals/:goalId/verdict, which
 * upserts the manager verdict (outranks the AI tier) and notifies the
 * report. Pre-fills the current tier; flags the AI's suggestion when the
 * goal was only AI-graded so far.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiPut } from "@/lib/api-client";
import { TIER_ORDER, TIER_LABELS } from "@/features/goal-tiers";

const TIER_DESC = {
  not_achieved: "Below the agreed bar for the cycle.",
  achieved: "Met the expectation for the role.",
  over_achieved: "Clearly exceeded the target.",
  role_model: "Set the standard others should follow.",
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

  useEffect(() => {
    if (!open || !goal) return;
    setTier(goal.tier?.tier ?? null);
    setNote(goal.tier?.source === "manager" ? (goal.tier?.reasoning ?? "") : "");
    setSaving(false);
  }, [open, goal]);

  if (!open || !goal) return null;

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

  return (
    <>
      <div
        className="fixed inset-0 z-[60]"
        style={{ background: "rgba(25,12,0,0.42)" }}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label={`Grade ${goal.title}`}
        className="fixed bottom-0 right-0 top-0 z-[61] flex w-[min(440px,100vw)] flex-col border-l bg-card"
        style={{
          borderColor: "var(--border-strong)",
          boxShadow: "-30px 0 70px -30px rgba(30,15,0,0.5)",
        }}
      >
        <div className="border-b border-border px-6 py-5">
          <div
            className="uppercase text-muted-fg"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              letterSpacing: "0.08em",
              fontWeight: 700,
            }}
          >
            Grade · achievement tier
          </div>
          <h2
            className="mt-2 font-semibold"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 19,
              letterSpacing: "-0.3px",
            }}
          >
            {goal.title}
          </h2>
          <div
            className="mt-1.5 text-muted-fg"
            style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
          >
            {firstName} · you set the final tier
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {aiSuggested ? (
            <div className="mb-5 flex gap-2.5 rounded-md border border-border bg-card-alt px-3 py-2.5">
              <span
                className="flex-none rounded border border-border px-1.5 py-0.5 text-muted-fg"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  height: "fit-content",
                }}
              >
                AI
              </span>
              <p className="text-[12.5px] leading-snug text-muted-fg">
                Suggested{" "}
                <b className="text-fg">{TIER_LABELS[aiSuggested]}</b> from the
                current data. Accept it or override.
              </p>
            </div>
          ) : null}

          <div className="grid gap-2">
            {TIER_ORDER.map((t) => {
              const active = tier === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTier(t)}
                  aria-pressed={active}
                  className="relative flex items-center gap-3 rounded-md border px-3.5 py-3 text-left transition-colors"
                  style={{
                    borderColor: active ? "var(--accent)" : "var(--border)",
                    background: active ? "var(--accent-dim)" : "var(--card)",
                    boxShadow: active ? "inset 0 0 0 1px var(--accent)" : "none",
                  }}
                >
                  <span
                    className="grid h-5 w-5 flex-none place-items-center rounded-full"
                    style={{
                      border: `2px solid ${active ? "var(--accent)" : "var(--border-strong)"}`,
                    }}
                  >
                    {active ? (
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: "var(--accent)" }}
                      />
                    ) : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-semibold">
                      {TIER_LABELS[t]}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-fg">
                      {TIER_DESC[t]}
                    </span>
                  </span>
                  {aiSuggested === t ? (
                    <span
                      className="ml-auto flex-none rounded-full px-2 py-0.5"
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 8.5,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        background: "var(--fg)",
                        color: "var(--bg)",
                      }}
                    >
                      AI
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <label
            className="mt-5 block uppercase text-muted-fg"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              letterSpacing: "0.06em",
            }}
          >
            Note to the engineer{" "}
            <span style={{ textTransform: "none", color: "var(--dim-fg)" }}>
              (optional)
            </span>
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What earned this tier? They'll see this with the grade."
            className="mt-2 w-full rounded-md border border-border bg-card-alt px-3 py-2.5 text-[13px] leading-relaxed"
            style={{ minHeight: 92, resize: "vertical", fontFamily: "var(--font-sans)" }}
          />
        </div>

        <div className="border-t border-border px-6 py-4">
          <div className="mb-2.5 flex items-center gap-2 text-[11.5px] text-muted-fg">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="flex-none"
            >
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.7 21a2 2 0 0 1-3.4 0" />
            </svg>
            {firstName} will be notified and can see your note.
          </div>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-md border px-4 py-2 text-[13px] font-semibold transition-colors hover:bg-card-alt"
              style={{ borderColor: "var(--border-strong)" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex-[2] rounded-md px-4 py-2 text-[13px] font-semibold text-accent-on transition-opacity disabled:opacity-60"
              style={{ background: "var(--accent)" }}
            >
              {saving ? "Saving…" : "Save grade"}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

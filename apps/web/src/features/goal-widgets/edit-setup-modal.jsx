"use client";

/**
 * "Edit setup" modal — tweak a COMMITTED widget's targets and (for a
 * SCORECARD) its component weights / targets / scope, without re-running
 * the AI classifier.
 *
 * Contrast with the two neighbours:
 *   - re-analyze      → runs the AI, then opens the analyst Review pane
 *                       (may swap the whole widget kind; wipes history).
 *   - build my own    → replaces the widget with a described COMPOSED
 *                       tracker (wipes history).
 *   - edit setup (here) → same widget, same kind, same history — just
 *                       adjust the numbers. So it saves WITHOUT the
 *                       `replace` flag (locked tiers are preserved) and
 *                       WITHOUT clearing logged entries: the reading the
 *                       goal already has stays valid, only the target /
 *                       weights that grade it change.
 *
 * The editor itself (`SpecSetupEditor`) is the same control the Review
 * pane uses on a pending spec — reused here on a committed one, so there
 * is a single place that knows how to edit a spec's setup.
 *
 * Presentation host mirrors ComposeWidgetModal: centred fixed overlay,
 * backdrop + ESC close.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { SpecSetupEditor } from "@/features/analyst";
import { saveSpec } from "@/features/goal-specs";

export function EditSetupModal({ open, onClose, spec, goal, onSaved }) {
  // Local working copy — edits don't touch the store until Save.
  const [draft, setDraft] = useState(spec);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  // Re-seed the draft when the modal opens (or switches to a different
  // goal). Keyed on goalId — NOT the spec object — so a background SWR
  // revalidation that recreates the spec reference mid-edit doesn't wipe
  // the user's in-progress edits. (Mirrors ComposeWidgetModal.)
  useEffect(() => {
    if (open) {
      setDraft(spec);
      setError(null);
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, spec?.goalId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const goalTitle = useMemo(
    () => goal?.title || spec?.title || "this goal",
    [goal?.title, spec?.title],
  );

  if (!open || !draft) return null;

  function handleSave() {
    if (saving) return;
    setSaving(true);
    // Plain save (NOT replace): same widget kind, so preserving any
    // locked tiers is correct — the user only touched targets / weights.
    const result = saveSpec(draft);
    if (!result.ok) {
      setSaving(false);
      setError(
        `Couldn't save: ${(result.errors || []).join(", ") || "invalid setup"}`,
      );
      return;
    }
    // Deliberately NO clearGoalEntries / clearGoalLocks here — an edit
    // keeps the same widget, so the goal's logged history is still valid.
    toast.success("Setup updated.");
    onSaved?.();
    onClose?.();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit widget setup"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        className="flex max-h-[86vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[var(--radius-tile)]"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border-strong)",
          boxShadow: "rgba(0,0,0,0.35) 0px 24px 72px",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between gap-3 border-b px-4 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="min-w-0">
            <div
              className="uppercase tracking-[0.5px]"
              style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--muted-fg)" }}
            >
              Edit setup · targets & weights
            </div>
            <div
              className="truncate font-semibold"
              style={{ fontFamily: "var(--font-display)", fontSize: 16, letterSpacing: "-0.3px" }}
              title={goalTitle}
            >
              {goalTitle}
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => onClose?.()}
            className="rounded-[var(--radius-sub)] px-2.5 py-1 transition-opacity hover:opacity-80"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.5px",
              border: "1px solid var(--border-strong)",
              color: "var(--muted-fg)",
              background: "transparent",
            }}
          >
            ✕ ESC
          </button>
        </div>

        {/* Body — the shared spec-setup editor on a local draft. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div
            className="mb-3"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              lineHeight: 1.5,
              color: "var(--dim-fg)",
            }}
          >
            Adjust this widget's target{draft.widget === "SCORECARD" ? " and component weights" : ""}.
            To change HOW it's tracked (a different widget), use{" "}
            <strong>re-analyze</strong> instead.
          </div>
          <SpecSetupEditor spec={draft} onChange={setDraft} />

          {/* Numeric-ladder goals grade the achievement badge off a fixed
              `tierScale`, not the target line — so be honest that editing
              the target moves the on-target reading but not the tier badge. */}
          {draft.tierScale ? (
            <div
              className="mt-3 rounded-[var(--radius-sub)] px-2.5 py-2"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9.5,
                lineHeight: 1.5,
                color: "var(--warn)",
                background: "color-mix(in srgb, var(--warn) 12%, transparent)",
              }}
            >
              This goal's achievement tiers use a fixed numeric ladder.
              Editing the target updates the on-target reading, but not the
              tier thresholds — <strong>re-analyze</strong> to regenerate them.
            </div>
          ) : null}

          {error ? (
            <div
              className="mt-2.5"
              style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--bad)", lineHeight: 1.45 }}
            >
              {error}
            </div>
          ) : null}
        </div>

        {/* Footer actions */}
        <div
          className="flex items-center justify-between gap-2 border-t px-4 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <button
            type="button"
            onClick={() => onClose?.()}
            className="uppercase tracking-[0.5px] transition-opacity hover:opacity-80"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--muted-fg)", background: "transparent" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-[var(--radius-sub)] px-4 py-2 font-bold uppercase transition-[filter] hover:brightness-110"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.5px",
              color: "var(--accent-on)",
              background: "var(--accent)",
              border: "1px solid var(--accent)",
              opacity: saving ? 0.6 : 1,
              cursor: saving ? "wait" : "pointer",
            }}
          >
            {saving ? "Saving…" : "Save setup"}
          </button>
        </div>
      </div>
    </div>
  );
}

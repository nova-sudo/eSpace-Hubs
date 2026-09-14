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
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { X } from "lucide-react";
import { SpecSetupEditor } from "@/features/analyst";
import { saveSpec } from "@/features/goal-specs";
import { Button, IconButton, Label } from "@/components/ui";

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
  if (typeof document === "undefined") return null;

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

  // Portal to document.body — escape the AppShell's transform wrapper, which
  // would otherwise be the containing block for this fixed overlay and clip it.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit widget setup"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-fg/40 p-5"
    >
      <div
        className="flex max-h-[86vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[var(--radius-xl)] bg-card"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <Label>Edit setup · targets &amp; weights</Label>
            <div className="truncate text-[18px] font-bold tracking-[-0.01em] text-fg" title={goalTitle}>
              {goalTitle}
            </div>
          </div>
          <IconButton label="Close" onCard onClick={() => onClose?.()}>
            <X size={16} />
          </IconButton>
        </div>

        {/* Body — the shared spec-setup editor on a local draft. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="mb-3 text-[12.5px] leading-[1.5] text-muted-fg">
            Adjust this widget's target{draft.widget === "SCORECARD" ? " and component weights" : ""}.
            To change HOW it's tracked (a different widget), use{" "}
            <strong className="text-fg">re-analyze</strong> instead.
          </div>
          <SpecSetupEditor spec={draft} onChange={setDraft} />

          {/* Numeric-ladder goals grade the achievement badge off a fixed
              `tierScale`, not the target line — so be honest that editing
              the target moves the on-target reading but not the tier badge. */}
          {draft.tierScale ? (
            <div className="mt-3 rounded-[var(--radius-lg)] bg-lemon px-3 py-2.5 text-[12.5px] leading-[1.5] text-lemon-ink">
              This goal's achievement tiers use a fixed numeric ladder.
              Editing the target updates the on-target reading, but not the
              tier thresholds — <strong>re-analyze</strong> to regenerate them.
            </div>
          ) : null}

          {error ? (
            <div className="mt-3 text-[13px] leading-[1.45] text-peach-ink">{error}</div>
          ) : null}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 border-t border-line px-6 py-4">
          <Button type="button" variant="ghost" size="sm" onClick={() => onClose?.()}>
            Cancel
          </Button>
          <Button type="button" variant="ink" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save setup"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

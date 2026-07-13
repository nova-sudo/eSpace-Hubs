"use client";

/**
 * "Describe your own tracker" modal — the manual escape hatch when the AI
 * classifier can't find a widget that fits (or picks the wrong one).
 *
 * Flow: the user types, in plain English, how they want to track the goal →
 * we POST it to /ai/compose-widget which returns a validated COMPOSED spec →
 * we preview the generated fields + cadence + tiers → "Use this tracker" saves
 * the spec (and wipes any prior widget's logged history, mirroring re-analyze).
 *
 * Presentation-only host: a centred fixed overlay (backdrop + ESC close),
 * matching GoalWidgetModal. Reachable from the ContextCollector ("describe your
 * own") and from a mounted widget's "build my own" control.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { composeWidget } from "@/features/analyst";
import { saveSpec } from "@/features/goal-specs";
import { clearGoalEntries } from "@/features/goal-inputs";
import { clearGoalLocks } from "@/features/goal-locks";

const PHASE = { INPUT: "input", BUSY: "busy", PREVIEW: "preview" };

const KIND_HINT = {
  checkbox: "yes / no",
  counter: "count",
  scale: "1–5",
  number: "number",
  text: "note",
  date: "date",
  select: "choice",
  link: "link",
};

export function ComposeWidgetModal({ open, onClose, spec, goal, onSaved }) {
  const [description, setDescription] = useState("");
  const [phase, setPhase] = useState(PHASE.INPUT);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null); // { spec, seeded }
  const [saving, setSaving] = useState(false);

  // Reset the flow each time the modal opens for a goal.
  useEffect(() => {
    if (open) {
      setDescription("");
      setPhase(PHASE.INPUT);
      setError(null);
      setPreview(null);
      setSaving(false);
    }
  }, [open, spec?.goalId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const goalId = spec?.goalId;
  const goalTitle = goal?.title || spec?.title || "this goal";

  async function handleGenerate() {
    const desc = description.trim();
    if (desc.length < 3) {
      setError("Describe how you'd track this — what you'd log, and how often.");
      return;
    }
    setError(null);
    setPhase(PHASE.BUSY);
    try {
      const result = await composeWidget({
        goalId,
        goalTitle: goal?.title || spec?.title,
        description: desc,
      });
      setPreview(result);
      setPhase(PHASE.PREVIEW);
    } catch (err) {
      setError(err?.message || String(err));
      setPhase(PHASE.INPUT);
    }
  }

  function handleUse() {
    if (!preview?.spec || saving) return;
    setSaving(true);
    // `replace: true` — a deliberate whole-widget swap. Bypasses saveSpec's
    // locked-tiers preserve so the tracker keeps the tiers shown in the
    // preview (not a prior widget's locked tiers / numeric ladder).
    const result = saveSpec(preview.spec, { replace: true });
    if (!result.ok) {
      setSaving(false);
      setError(
        `Couldn't save the tracker: ${(result.errors || []).join(", ") || "invalid spec"}`,
      );
      return;
    }
    // A fresh tracker replaces whatever widget was here — wipe the old
    // logged history + settle-locks so it starts clean (same as re-analyze).
    clearGoalEntries(goalId);
    clearGoalLocks(goalId);
    toast.success("Custom tracker created.");
    onSaved?.();
    onClose?.();
  }

  // Portal to document.body — escape the AppShell's transform wrapper, which
  // would otherwise be the containing block for this fixed overlay and clip it.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Describe your own tracker"
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
              Build your own tracker
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

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {phase === PHASE.PREVIEW && preview?.spec ? (
            <SpecPreview preview={preview} />
          ) : (
            <>
              <label
                className="mb-1.5 block uppercase tracking-[0.5px]"
                style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted-fg)" }}
              >
                How do you want to track this goal?
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={phase === PHASE.BUSY}
                rows={5}
                autoFocus
                placeholder={
                  'e.g. "Each quarter I want to log how many chapters I read — target 5 — plus a short note on what I read."'
                }
                className="w-full rounded-[var(--radius-sub)] p-2.5 outline-none focus:border-accent"
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  color: "var(--fg)",
                  background: "var(--card-alt)",
                  border: "1px solid var(--border)",
                  resize: "vertical",
                }}
              />
              <div
                className="mt-1.5"
                style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--dim-fg)", lineHeight: 1.5 }}
              >
                Say what you'd record and how often. The AI turns it into a fillable
                tracker — with per-period windows (weekly / monthly / quarterly) if
                you mention a cadence.
              </div>
            </>
          )}

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
          {phase === PHASE.PREVIEW ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setPhase(PHASE.INPUT);
                  setPreview(null);
                  setError(null);
                }}
                className="uppercase tracking-[0.5px] transition-opacity hover:opacity-80"
                style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--muted-fg)", background: "transparent" }}
              >
                ← Re-describe
              </button>
              <button
                type="button"
                onClick={handleUse}
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
                {saving ? "Saving…" : "Use this tracker →"}
              </button>
            </>
          ) : (
            <>
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
                onClick={handleGenerate}
                disabled={phase === PHASE.BUSY || description.trim().length < 3}
                className="rounded-[var(--radius-sub)] px-4 py-2 font-bold uppercase transition-[filter] hover:brightness-110"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.5px",
                  color: "var(--accent-on)",
                  background: "var(--accent)",
                  border: "1px solid var(--accent)",
                  opacity: phase === PHASE.BUSY || description.trim().length < 3 ? 0.55 : 1,
                  cursor: phase === PHASE.BUSY ? "wait" : "pointer",
                }}
              >
                {phase === PHASE.BUSY ? "Designing…" : "Generate tracker →"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Read-only preview of the generated COMPOSED spec: cadence + fields + tiers. */
function SpecPreview({ preview }) {
  const spec = preview.spec;
  const fields = Array.isArray(spec.fields) ? spec.fields : [];
  const cadence = spec.composed?.cadence || null;
  const prompt = spec.composed?.prompt || null;
  const tiers = spec.tiers || null;

  return (
    <div className="flex flex-col gap-3">
      {preview.seeded ? (
        <div
          className="rounded-[var(--radius-sub)] px-2.5 py-2"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            lineHeight: 1.5,
            color: "var(--warn)",
            background: "color-mix(in srgb, var(--warn) 12%, transparent)",
          }}
        >
          The AI couldn't parse specific fields, so this is a generic tracker.
          Re-describe with the exact things you'd log for a better fit.
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center rounded-full px-2 py-[2px] font-semibold uppercase"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            letterSpacing: "0.4px",
            background: "var(--accent-dim)",
            color: "var(--accent)",
          }}
        >
          {cadence ? `${cadence} record` : "single record"}
        </span>
        {prompt ? (
          <span
            className="min-w-0 truncate"
            style={{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--muted-fg)" }}
            title={prompt}
          >
            {prompt}
          </span>
        ) : null}
      </div>

      <div>
        <div
          className="mb-1.5 uppercase tracking-[0.5px]"
          style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--muted-fg)" }}
        >
          You'll log {fields.length} field{fields.length === 1 ? "" : "s"} each {cadence || "time"}
        </div>
        <div className="flex flex-col gap-1.5">
          {fields.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between gap-2 rounded-[var(--radius-sub)] px-2.5 py-1.5"
              style={{ background: "var(--card-alt)", border: "1px solid var(--border)" }}
            >
              <span className="min-w-0 truncate" style={{ fontFamily: "var(--font-sans)", fontSize: 13 }} title={f.label}>
                {f.label}
                {f.unit ? (
                  <span style={{ color: "var(--dim-fg)" }}> ({f.unit})</span>
                ) : null}
              </span>
              <span
                className="shrink-0 uppercase"
                style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--dim-fg)", letterSpacing: "0.4px" }}
              >
                {f.target ? `${KIND_HINT[f.kind] || f.kind} · ${f.target.op}${f.target.value}` : KIND_HINT[f.kind] || f.kind}
              </span>
            </div>
          ))}
        </div>
      </div>

      {tiers ? (
        <div>
          <div
            className="mb-1.5 uppercase tracking-[0.5px]"
            style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--muted-fg)" }}
          >
            Achievement tiers
          </div>
          <div className="flex flex-col gap-1" style={{ fontFamily: "var(--font-sans)", fontSize: 12, lineHeight: 1.45 }}>
            {[
              ["Achieved", tiers.achieved],
              ["Over-achieved", tiers.overAchieved],
              ["Role model", tiers.roleModel],
            ]
              .filter(([, v]) => v)
              .map(([label, v]) => (
                <div key={label}>
                  <span style={{ color: "var(--muted-fg)", fontFamily: "var(--font-mono)", fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.4px", marginRight: 6 }}>
                    {label}
                  </span>
                  <span style={{ color: "var(--fg)" }}>{v}</span>
                </div>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

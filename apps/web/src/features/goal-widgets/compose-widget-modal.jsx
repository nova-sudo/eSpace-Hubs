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
 * Documents (Phase 1). Most people already *have* the plan — a manager's Word
 * doc, a spreadsheet built in a 1:1 — and retyping it into a 2,000-character
 * box loses fidelity to time pressure. So the user can attach one file, which
 * adds two phases between INPUT and BUSY:
 *
 *   INPUT ──(file)──▶ EXTRACTING ──▶ EXTRACT_REVIEW ──▶ BUSY ──▶ PREVIEW
 *     └───────────────(no file, unchanged path)────────▶ BUSY ──▶ PREVIEW
 *
 * EXTRACTING is deliberately NOT the BUSY spinner: reading a document is a
 * different latency and failure domain than composing (a big PDF is slow; a
 * scanned one fails outright), and one generic "Designing…" would mislabel
 * both. EXTRACT_REVIEW puts the extracted text in an *editable* textarea
 * because extraction is lossy in ways only the author can spot — this is the
 * last cheap moment to fix it, before the text is sent to an AI provider.
 *
 * Phase 1 feeds the existing, unmodified COMPOSED schema, so a rich document
 * genuinely cannot survive intact (one cadence, one flat field list). That
 * lossiness is acceptable only because it's *surfaced*: `unrepresented` renders
 * in the same "we weren't sure" banner family as the long-standing `seeded`
 * warning — one visual vocabulary, never two.
 *
 * Automatic fields. A composed spec may now contain fields the server fills
 * from the user's GitHub/GitLab, and those queries need things only the user
 * knows — which repository, which host. The AI asks for them as ordinary
 * `spec.context` questions, which adds one more phase:
 *
 *   … ──▶ PREVIEW ──(spec.context unanswered)──▶ CONTEXT ──▶ PREVIEW ──▶ submit
 *
 * CONTEXT reuses the ContextCollector shell verbatim rather than growing a
 * second question form here — it already renders every CONTEXT_QUESTION_KIND,
 * including selects and resource links, and two forms answering the same
 * questions is exactly how the two would drift apart. It is a hard gate: a
 * tracker whose queries cannot resolve their params is worse than one with no
 * queries at all, because it looks automatic and reports nothing.
 *
 * Presentation-only host: a centred fixed overlay (backdrop + ESC close),
 * matching GoalWidgetModal. Reachable from the ContextCollector ("describe your
 * own") and from a mounted widget's "build my own" control.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { FileText, Paperclip, Sparkles, X } from "lucide-react";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  composeWidget,
  extractComposeAttachment,
} from "@/features/analyst";
import { saveSpec } from "@/features/goal-specs";
import { clearGoalEntries } from "@/features/goal-inputs";
import { clearGoalLocks } from "@/features/goal-locks";
import { apiPost } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { Badge, Button, IconButton, Label } from "@/components/ui";
import { useIsContextComplete } from "@/features/goal-context";
import { ContextCollector } from "./state-shells/context-collector";
import { WidgetErrorBoundary } from "./widget-error-boundary";
// One vocabulary for field kinds: the preview names them here and the form
// names them beside each label, so they come from the same map.
import { FIELD_KIND_HINT } from "./field-status";
import { PlanEditor } from "./plan-editor/plan-editor";
import {
  describeCycle,
  isPlanCadence,
  resolvePlanBounds,
  stampBounds,
} from "./plan-editor/plan-model";
// Namespace import for the same reason composed-fields.jsx uses one: the
// plain-English sentence for a query belongs to the shared registry, and a
// named import would make this modal fail to build against an older shared
// package rather than simply describe the field less richly.
import * as sharedGoalSpecs from "@espace-devhub/shared/goal-specs";

const PHASE = {
  INPUT: "input",
  EXTRACTING: "extracting",
  EXTRACT_REVIEW: "extract_review",
  BUSY: "busy",
  PREVIEW: "preview",
  PLAN: "plan",
  CONTEXT: "context",
};

/**
 * Announced through the aria-live region on every phase change. This modal
 * swaps its whole body between phases with no focus move of its own, so a
 * screen-reader user would otherwise hear nothing at all between "Generate"
 * and a preview appearing.
 */
const PHASE_ANNOUNCEMENT = {
  [PHASE.INPUT]: "",
  [PHASE.EXTRACTING]: "Reading your document.",
  [PHASE.EXTRACT_REVIEW]: "Document read. Check the text before we design the tracker.",
  [PHASE.BUSY]: "Designing your tracker.",
  [PHASE.PREVIEW]: "Tracker ready to review.",
  [PHASE.PLAN]: "The plan, laid out window by window. Check the cycle before submitting.",
  [PHASE.CONTEXT]: "A few answers are needed before this tracker can read your repository.",
};

const ACCEPTED_EXTENSIONS = ATTACHMENT_ACCEPT.split(",");

export function ComposeWidgetModal({ open, onClose, spec, goal, onSaved }) {
  const [description, setDescription] = useState("");
  const [phase, setPhase] = useState(PHASE.INPUT);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null); // { spec, seeded, unrepresented }
  // The composed block the user is reviewing in the PLAN step — seeded from
  // the AI's, then theirs to correct. Held apart from `preview` so
  // "Re-describe" throws the AI's proposal away without carrying a stale
  // plan forward, and so the preview object stays exactly what the server
  // returned.
  const [planDraft, setPlanDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  // The attached File stays in state across failures on purpose — a transient
  // 500 should never cost the user a second upload.
  const [file, setFile] = useState(null);
  const [extracted, setExtracted] = useState(null); // server result, kept for provenance
  // True once THIS file has failed to extract, so the primary button stops
  // retrying a read that will fail identically and composes instead.
  const [extractFailed, setExtractFailed] = useState(false);
  const [extractText, setExtractText] = useState(""); // the user-editable copy
  const fileInputRef = useRef(null);
  const reviewHeadingRef = useRef(null);
  const extractAbortRef = useRef(null);

  // Reset the flow each time the modal opens for a goal.
  useEffect(() => {
    if (open) {
      setDescription("");
      setPhase(PHASE.INPUT);
      setError(null);
      setPreview(null);
      setPlanDraft(null);
      setSaving(false);
      setFile(null);
      setExtracted(null);
    setExtractFailed(false);
      setExtractText("");
    }
  }, [open, spec?.goalId]);

  // Never leave an upload running behind a closed modal.
  useEffect(() => {
    if (!open) extractAbortRef.current?.abort();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      // ESC must not silently bin an in-flight extraction — the file is
      // already uploaded and the user has no way to know it was thrown away.
      if (phase === PHASE.EXTRACTING) {
        setError("Still reading your document. Cancel that first, or wait for it to finish.");
        return;
      }
      onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, phase]);

  // Focus management: EXTRACT_REVIEW asks the user to verify something, so
  // land them on its heading rather than leaving focus on the (now gone)
  // Generate button.
  useEffect(() => {
    if (phase === PHASE.EXTRACT_REVIEW) reviewHeadingRef.current?.focus();
  }, [phase]);

  // The same completeness rule the widget resolver uses, applied to the spec
  // we have not saved yet. Answers live in the goal-context store keyed by
  // goalId, which is also where the server reads them from when it resolves a
  // field's query — so answering here is not a preview-only formality, it is
  // the real thing, written early. Hooks run before the `open` early-return
  // below; `useIsContextComplete` treats a null spec as complete, so a closed
  // modal or a spec with no questions costs nothing.
  const contextComplete = useIsContextComplete(preview?.spec || null);
  const needsContext =
    Boolean(preview?.spec?.context?.required) && !contextComplete;

  // The cycle the plan step resolves — computed here (not only inside the
  // step) because the PREVIEW summary shows it too: "13 weeks · 1 Sep – 30
  // Nov" is the single most checkable thing about a document-derived
  // tracker, and the one the AI most often gets wrong.
  const planBounds = useMemo(
    () => (planDraft ? resolvePlanBounds(planDraft, { goal }) : null),
    [planDraft, goal],
  );
  const hasPlan = Boolean(planDraft && isPlanCadence(planDraft.cadence));

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const goalId = spec?.goalId;
  const goalTitle = goal?.title || spec?.title || "this goal";
  const busy = phase === PHASE.BUSY;
  const canGenerate = description.trim().length >= 3 || Boolean(file);

  function requestClose() {
    if (phase === PHASE.EXTRACTING) {
      setError("Still reading your document. Cancel that first, or wait for it to finish.");
      return;
    }
    onClose?.();
  }

  /** Client-side gate — reject the obvious cases before spending an upload. */
  function acceptFile(candidate) {
    if (!candidate) return;
    const name = candidate.name || "";
    // lastIndexOf returns -1 for a file with no dot at all, and slice(-1)
    // would then hand back the final CHARACTER — "README" became "we can't
    // read E." Treat "no extension" as its own case.
    const dot = name.lastIndexOf(".");
    const ext = dot === -1 ? "" : name.slice(dot).toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      setError(
        `We can't read ${ext || "that file type"}. Attach a PDF, DOCX, XLSX, XLS or CSV.`,
      );
      return;
    }
    if (candidate.size > ATTACHMENT_MAX_BYTES) {
      setError(
        `${name} is ${formatBytes(candidate.size)} — the limit is 10 MB. Try a smaller export.`,
      );
      return;
    }
    setError(null);
    setFile(candidate);
    // A new file invalidates whatever we read from the old one.
    setExtracted(null);
    setExtractFailed(false);
    setExtractText("");
  }

  function removeFile() {
    setFile(null);
    setExtracted(null);
    setExtractFailed(false);
    setExtractText("");
    setError(null);
  }

  async function handleExtract() {
    const controller = new AbortController();
    extractAbortRef.current = controller;
    setError(null);
    setPhase(PHASE.EXTRACTING);
    try {
      const result = await extractComposeAttachment({
        goalId,
        file,
        signal: controller.signal,
      });
      setExtracted(result);
      setExtractText(result.text);
      setPhase(PHASE.EXTRACT_REVIEW);
    } catch (err) {
      // A user-initiated cancel isn't an error worth shouting about.
      if (controller.signal.aborted) {
        setPhase(PHASE.INPUT);
        return;
      }
      // Back to INPUT with the description AND the file intact — retrying a
      // flaky upload should never mean re-picking the file. But remember that
      // THIS file already failed, so the next press of the primary button
      // composes from the typed description instead of retrying extraction
      // forever. Without this the error copy ("…or describe it below") is a
      // lie for the scanned-PDF case: the button would just re-extract, fail,
      // and re-extract, and the only way out is spotting the chip's remove
      // control.
      setExtractFailed(true);
      setError(err?.message || String(err));
      setPhase(PHASE.INPUT);
    } finally {
      extractAbortRef.current = null;
    }
  }

  /**
   * The server's `description` is `min(3)`, but with a document attached the
   * typed box is genuinely optional ("add anything the doc doesn't cover").
   * Stand in a truthful sentence rather than forcing busywork typing.
   */
  function effectiveDescription() {
    const typed = description.trim();
    if (typed.length >= 3) return typed;
    const name = extracted?.sourceFilename || file?.name;
    return name ? `Build a tracker from the attached document (${name}).` : typed;
  }

  async function handleGenerate() {
    // An attached-but-unread file routes through extraction first; the same
    // button drives both steps so there's only ever one primary action.
    // `extractFailed` is the escape hatch: once this file has failed to read,
    // pressing the button again composes from the typed description rather
    // than looping on an extraction that will fail the same way.
    if (file && !extracted && !extractFailed) {
      void handleExtract();
      return;
    }
    const desc = effectiveDescription();
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
        attachment: extracted
          ? {
              text: extractText,
              sourceFilename: extracted.sourceFilename,
              sourceType: extracted.sourceType,
            }
          : undefined,
      });
      setPreview(result);
      setPlanDraft(result?.spec?.composed ? { ...result.spec.composed } : null);
      setPhase(PHASE.PREVIEW);
    } catch (err) {
      setError(err?.message || String(err));
      setPhase(PHASE.INPUT);
    }
  }

  async function handleUse() {
    if (!preview?.spec || saving) return;
    // Hard gate, not a nudge. A source-backed field whose params never resolve
    // renders as an automatic field that permanently reads "—", which is worse
    // than a typed field: it looks like the tracker is working. Submitting for
    // approval would also hand a manager something they cannot evaluate.
    if (needsContext) {
      setError(
        "This tracker reads from your repository — answer the setup questions first.",
      );
      setPhase(PHASE.CONTEXT);
      return;
    }
    setSaving(true);
    // P4: a Build-Your-Own tracker enters "pending" — read-only until the
    // manager approves. `replace: true` is a deliberate whole-widget swap
    // (bypasses saveSpec's locked-tiers preserve) so it keeps the previewed
    // tiers.
    //
    // The cycle is whatever the PLAN step resolved and the user accepted —
    // stamped on explicitly (start + end, plus periodCount for a flat plan)
    // so the saved tracker can never fall back to the calendar year. That
    // fallback is the 53-weeks-for-a-13-week-plan bug: a plan with no stored
    // end tiles a whole year of windows, and every window past the plan's
    // real length is an empty cell the user is told they owe.
    //
    // resolvePlanBounds applies the same precedence the plan editor showed:
    // authored periods > the AI's stated length > a stored end > a year.
    // The AI's own cycleStart wins over the goal's startDate (it read the
    // document; a goal's stored date is often unset or describes a wider
    // window), which is what resolvePlanBounds does with `goal` passed in.
    const previewSpec = preview.spec;
    const block = planDraft || previewSpec.composed;
    const bounds = resolvePlanBounds(block, { goal });
    const composed = bounds ? stampBounds(block, bounds) : block;
    const pendingSpec = {
      ...previewSpec,
      composed,
      approval: { status: "pending", submittedAt: Date.now() },
    };
    const result = saveSpec(pendingSpec, { replace: true });
    if (!result.ok) {
      setSaving(false);
      setError(
        `Couldn't save the tracker: ${(result.errors || []).join(", ") || "invalid spec"}`,
      );
      return;
    }
    // A fresh tracker replacing a DIFFERENT widget kind starts clean
    // (same as re-analyze) — but a REVISION of an existing COMPOSED
    // tracker keeps its history: "revise & resubmit" after a manager's
    // change-request used to destroy every logged entry and settle-lock
    // on the goal, which made the one manager→dev feedback loop a data
    // hazard. Stale field ids from a revised shape are simply ignored
    // by the renderers.
    const revisingComposed = spec?.widget === previewSpec.widget;
    if (!revisingComposed) {
      clearGoalEntries(goalId);
      clearGoalLocks(goalId);
    }

    // Route it for approval. No manager on file → the server says "approved"
    // and we activate immediately; otherwise it stays pending (read-only) and
    // the manager is notified.
    const r = await apiPost(
      `/goal-specs/${encodeURIComponent(goalId)}/submit-approval`,
      {},
    );
    const status = r.ok ? r.data?.status || "pending" : "pending";
    if (status === "approved") {
      saveSpec(
        { ...pendingSpec, approval: { status: "approved" } },
        { replace: true },
      );
      // Honest about the missing gate: with no manager on file the
      // server auto-approves — say so instead of implying a review
      // happened.
      if (r.data?.autoApproved) {
        toast.success("Custom tracker created.", {
          description:
            "No manager on file, so it went live without a review.",
        });
      } else {
        toast.success("Custom tracker created.");
      }
    } else {
      toast.success("Sent to your manager for approval.", {
        description: "It goes live once they sign off.",
      });
    }
    setSaving(false);
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
        if (e.target === e.currentTarget) requestClose();
      }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-fg/40 p-5"
    >
      {/* The plan step lays out up to 53 windows with chips inside them, so
          it gets the wider card; every other step stays at the 560px
          single-column width the rest of the modal family uses. */}
      <div
        className={cn(
          "flex max-h-[86vh] w-full flex-col overflow-hidden rounded-[var(--radius-xl)] bg-card",
          phase === PHASE.PLAN ? "max-w-[980px]" : "max-w-[560px]",
        )}
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <Label>Build your own tracker</Label>
            <div className="truncate text-[18px] font-bold tracking-[-0.01em] text-fg" title={goalTitle}>
              {goalTitle}
            </div>
          </div>
          <IconButton label="Close" onCard onClick={requestClose}>
            <X size={16} />
          </IconButton>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {/* Phase transitions are otherwise silent for screen readers. */}
          <div role="status" aria-live="polite" className="sr-only">
            {PHASE_ANNOUNCEMENT[phase]}
          </div>

          {phase === PHASE.CONTEXT && preview?.spec ? (
            <ContextPanel
              spec={preview.spec}
              goal={goal}
              onSaved={() => {
                // The collector has committed the answers by now, so the
                // completeness hook has already flipped. Going back
                // unconditionally is safe: if something is still blank,
                // `needsContext` keeps the primary button pointing right back
                // here rather than letting an unresolvable tracker through.
                // Back to wherever the submit button lives for this tracker —
                // the plan step for a cadenced one, the preview otherwise.
                setError(null);
                setPhase(hasPlan ? PHASE.PLAN : PHASE.PREVIEW);
              }}
            />
          ) : phase === PHASE.PLAN && planDraft ? (
            <div className="flex flex-col gap-3">
              <div>
                <h2 className="text-[18px] font-bold tracking-[-0.01em] text-fg">Check the plan</h2>
                <div className="mt-1 text-[12.5px] leading-[1.5] text-muted-fg">
                  This is the cycle the tracker will run on, window by window. Fix the length or
                  the start date if they don&apos;t match your plan, and drag anything that landed
                  in the wrong window.
                </div>
              </div>
              <PlanEditor block={planDraft} onChange={setPlanDraft} goal={goal} />
            </div>
          ) : phase === PHASE.PREVIEW && preview?.spec ? (
            <SpecPreview preview={preview} needsContext={needsContext} planBounds={planBounds} />
          ) : phase === PHASE.EXTRACTING ? (
            <ExtractingPanel filename={file?.name} />
          ) : phase === PHASE.BUSY ? (
            <DesigningPanel />
          ) : phase === PHASE.EXTRACT_REVIEW ? (
            <ExtractReview
              headingRef={reviewHeadingRef}
              extracted={extracted}
              text={extractText}
              onChange={setExtractText}
            />
          ) : (
            <>
              <Label className="mb-1.5 block">How do you want to track this goal?</Label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={busy}
                rows={5}
                autoFocus
                placeholder={
                  file
                    ? "Add anything the document doesn't cover (optional)."
                    : 'e.g. "Each quarter I want to log how many chapters I read — target 5 — plus a short note on what I read."'
                }
                className="w-full resize-y rounded-[var(--radius-lg)] bg-card-alt p-3 text-[14px] leading-[1.5] text-fg outline-none placeholder:text-dim-fg focus:ring-2 focus:ring-ink"
              />

              {file ? (
                <FileChip
                  file={file}
                  read={Boolean(extracted)}
                  disabled={busy}
                  onRemove={removeFile}
                />
              ) : (
                <AttachDropZone
                  disabled={busy}
                  onPick={() => fileInputRef.current?.click()}
                  onDropFile={(f) => acceptFile(f)}
                />
              )}
              {/* Real input, kept out of the layout — same construction as the
                  goals importer, so keyboard and file-picker behaviour is the
                  browser's, not ours. */}
              <input
                ref={fileInputRef}
                type="file"
                accept={ATTACHMENT_ACCEPT}
                onChange={(e) => {
                  acceptFile(e.target.files?.[0]);
                  e.target.value = ""; // allow re-picking the same file
                }}
                className="hidden"
              />

              <div className="mt-2 text-[12.5px] leading-[1.5] text-muted-fg">
                Say what you'd record and how often. The AI turns it into a fillable
                tracker — with per-period windows (weekly / monthly / quarterly) if
                you mention a cadence.
              </div>
            </>
          )}

          {error ? (
            <div className="mt-3 text-[13px] leading-[1.45] text-peach-ink">{error}</div>
          ) : null}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 border-t border-line px-6 py-4">
          {phase === PHASE.CONTEXT ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setError(null);
                  setPhase(hasPlan ? PHASE.PLAN : PHASE.PREVIEW);
                }}
              >
                Back to tracker
              </Button>
              {/* No primary action here on purpose: the collector owns its own
                  submit, and a second "done" button beside it would be two
                  controls for one intent — one of which wouldn't commit the
                  answers. */}
              <span className="text-[12px] font-semibold text-dim-fg">
                Answers save with the form above
              </span>
            </>
          ) : phase === PHASE.PLAN ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setError(null);
                  setPhase(PHASE.PREVIEW);
                }}
              >
                Back to tracker
              </Button>
              <Button
                type="button"
                variant="ink"
                onClick={
                  needsContext
                    ? () => {
                        setError(null);
                        setPhase(PHASE.CONTEXT);
                      }
                    : handleUse
                }
                disabled={saving}
              >
                {saving ? "Submitting…" : needsContext ? "Set up auto-fill" : "Submit for approval"}
              </Button>
            </>
          ) : phase === PHASE.PREVIEW ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPhase(PHASE.INPUT);
                  setPreview(null);
                  setPlanDraft(null);
                  setError(null);
                }}
              >
                Re-describe
              </Button>
              {/* A cadenced tracker goes through the plan step before it can
                  be submitted. That step is where a mis-sized cycle gets
                  caught, and it's cheap to pass through when the AI got it
                  right — so it's the path, not an optional detour. */}
              <Button
                type="button"
                variant="ink"
                onClick={
                  hasPlan
                    ? () => {
                        setError(null);
                        setPhase(PHASE.PLAN);
                      }
                    : needsContext
                      ? () => {
                          setError(null);
                          setPhase(PHASE.CONTEXT);
                        }
                      : handleUse
                }
                disabled={saving}
              >
                {saving
                  ? "Submitting…"
                  : hasPlan
                    ? "Check the plan"
                    : needsContext
                      ? "Set up auto-fill"
                      : "Submit for approval"}
              </Button>
            </>
          ) : phase === PHASE.EXTRACTING ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => extractAbortRef.current?.abort()}
              >
                Cancel upload
              </Button>
              <Button type="button" variant="ink" disabled>
                Reading…
              </Button>
            </>
          ) : phase === PHASE.EXTRACT_REVIEW ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPhase(PHASE.INPUT);
                  setError(null);
                }}
              >
                Back
              </Button>
              <Button
                type="button"
                variant="ink"
                onClick={handleGenerate}
                disabled={extractText.trim().length === 0}
              >
                Looks good
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={requestClose}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="ink"
                onClick={handleGenerate}
                disabled={busy || !canGenerate}
              >
                {busy ? "Designing…" : "Generate tracker"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * "We weren't sure" banner. Every uncertainty signal in this modal — the AI
 * fell back to a generic tracker, part of a document didn't fit, the
 * extractor flattened something — renders through this one component so
 * users learn a single visual vocabulary instead of three.
 */
function WarnBanner({ children }) {
  return (
    <div className="rounded-[var(--radius-lg)] bg-lemon px-3 py-2.5 text-[12.5px] leading-[1.5] text-lemon-ink">
      {children}
    </div>
  );
}

/**
 * CONTEXT — the setup questions a source-backed field needs answered.
 *
 * Deliberately a thin wrapper: the collector is mounted as-is, with no
 * `onReclassify` (re-running the classifier here would throw away the tracker
 * the user just approved of) and no `onCompose` (they are already inside the
 * composer).
 */
function ContextPanel({ spec, goal, onSaved }) {
  const count = spec.context?.questions?.length || 0;
  // Bumped on "try again" to remount the collector after a crash — its draft
  // state is local, so a fresh mount is the only way back to a usable form.
  const [retryKey, setRetryKey] = useState(0);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-[18px] font-bold tracking-[-0.01em] text-fg">
          {count === 1 ? "One thing we need from you" : `${count} things we need from you`}
        </h2>
        <div className="mt-1 text-[12.5px] leading-[1.5] text-muted-fg">
          Some fields fill themselves from your repository. We can&apos;t guess
          which repo you mean, so answer these once and every automatic field
          reuses them.
        </div>
      </div>
      {/* Unlike the mounted-widget body, this had no error boundary — a bug in
          a single question's save path took down the whole modal instead of
          just this panel. */}
      <WidgetErrorBoundary onRetry={() => setRetryKey((k) => k + 1)}>
        <ContextCollector key={retryKey} spec={spec} goal={goal} onSaved={onSaved} />
      </WidgetErrorBoundary>
    </div>
  );
}

/**
 * Attach affordance — a real <button> with the drag handlers layered on top,
 * driving a real hidden <input type="file">. Same construction as the goals
 * importer's DropZone: accessible because it's a button, not because we
 * reimplemented keyboard handling on a div.
 */
function AttachDropZone({ onPick, onDropFile, disabled }) {
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label="Attach a document"
      onDragEnter={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDropFile(e.dataTransfer.files?.[0]);
      }}
      disabled={disabled}
      className={`mt-2.5 flex w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] px-3 py-3 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        over ? "bg-lav text-lav-ink" : "bg-card-alt text-muted-fg hover:text-fg"
      }`}
    >
      <Paperclip size={14} />
      Attach a plan — PDF, DOCX, XLSX, XLS or CSV, up to 10 MB
    </button>
  );
}

/** The attached file, as an explicit chip with a real, labelled remove control. */
function FileChip({ file, read, onRemove, disabled }) {
  return (
    <div className="mt-2.5 flex items-center gap-2 rounded-[var(--radius-lg)] bg-card-alt px-3 py-2.5">
      <FileText size={15} className="shrink-0 text-muted-fg" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-fg" title={file.name}>
        {file.name}
      </span>
      <Badge>{read ? `Read · ${formatBytes(file.size)}` : formatBytes(file.size)}</Badge>
      <IconButton label={`Remove ${file.name}`} size="sm" onCard onClick={onRemove} disabled={disabled}>
        <X size={13} />
      </IconButton>
    </div>
  );
}

/**
 * EXTRACTING — its own panel, not the BUSY spinner. It also carries the "we
 * don't keep the file" line, because the moment a user hands over a document
 * is the moment they want to know what happens to it.
 */
function ExtractingPanel({ filename }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <FileText size={22} className="animate-pulse text-muted-fg" />
      <div className="text-[18px] font-bold tracking-[-0.01em] text-fg">Reading your document…</div>
      {filename ? (
        <div className="max-w-full truncate text-[12.5px] text-muted-fg" title={filename}>
          {filename}
        </div>
      ) : null}
      <div className="max-w-[380px] text-[12.5px] leading-[1.55] text-muted-fg">
        We pull the text out on the server and throw the file away — it's never
        stored. You'll get to read and edit the text before anything is sent to
        the AI.
      </div>
    </div>
  );
}

/**
 * What the primary button just called "Designing…" used to hand back —
 * nothing. The body kept showing the (disabled) description box, so a slow
 * compose call looked like the click hadn't registered. This owns the wait:
 * the compose call runs one AI turn end-to-end with no intermediate progress
 * to report, so the cycling line is honest about that — it names what the
 * model is DECIDING, not a fake multi-step progress bar.
 */
const DESIGNING_STEPS = [
  "Reading what you described…",
  "Choosing a cadence…",
  "Picking the fields that measure it…",
  "Drafting achievement tiers…",
];

function DesigningPanel() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setStep((s) => (s + 1) % DESIGNING_STEPS.length),
      1800,
    );
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-lav">
        <Sparkles size={18} className="text-lav-ink" />
      </span>
      <div className="text-[18px] font-bold tracking-[-0.01em] text-fg">Designing your tracker…</div>
      <div className="min-h-[16px] text-[12.5px] text-muted-fg">{DESIGNING_STEPS[step]}</div>
    </div>
  );
}

/**
 * EXTRACT_REVIEW — the human-in-the-loop step. Editable on purpose: extraction
 * flattens tables, drops layout, and occasionally mangles a heading, and the
 * author is the only one who can tell. It's also the last point before the text
 * leaves for a third-party AI provider, so trimming is a privacy control, not
 * just a quality one.
 */
function ExtractReview({ headingRef, extracted, text, onChange }) {
  const warnings = extracted?.warnings || [];
  // Neutral "what I read" counts. Kept out of the WarnBanner deliberately:
  // the extractors emit one of these on every successful run, so routing them
  // through WarnBanner would make the warning state fire 100% of the time and
  // stop carrying any signal by the time a real one (a dropped table, a
  // skipped sheet) appears.
  const info = extracted?.info || [];
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-[18px] font-bold tracking-[-0.01em] text-fg outline-none"
        >
          Here's what we read
        </h2>
        <div className="mt-1 text-[12.5px] leading-[1.5] text-muted-fg">
          {extracted?.sourceFilename ? `${extracted.sourceFilename} · ` : ""}
          {text.length.toLocaleString()} characters. Fix anything that came out
          wrong, or delete what you don't want sent.
        </div>
      </div>

      {extracted?.truncated ? (
        <WarnBanner>
          The document was longer than we can send, so this is the first 20,000
          characters. Trim it down to the part that matters most.
        </WarnBanner>
      ) : null}

      {warnings.length > 0 ? (
        <WarnBanner>
          {warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </WarnBanner>
      ) : null}

      {info.length > 0 ? (
        <div className="text-[12.5px] leading-[1.6] text-muted-fg">
          {info.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      ) : null}

      <label className="sr-only" htmlFor="compose-extract-text">
        Extracted document text
      </label>
      <textarea
        id="compose-extract-text"
        value={text}
        onChange={(e) => onChange(e.target.value)}
        rows={14}
        className="w-full resize-y rounded-[var(--radius-lg)] bg-card-alt p-3 text-[12.5px] leading-[1.55] text-fg outline-none focus:ring-2 focus:ring-ink"
      />
    </div>
  );
}

/** Is this field filled by the server from a repo host rather than by the user? */
function isAutoField(f) {
  return Boolean(f?.source && typeof f.source === "object" && f.source.query);
}

/**
 * The one-sentence, plain-English account of what an automatic field will read.
 * Sourced from the shared registry, which is also what the manager sees on the
 * approval screen — the person approving and the person who asked for it should
 * be reading the same sentence, or one of them is being told a different story.
 */
function describeSource(source) {
  try {
    return sharedGoalSpecs.describeQuerySource?.(source) || null;
  } catch {
    return null;
  }
}

/** Read-only preview of the generated COMPOSED spec: cycle + fields + tiers. */
function SpecPreview({ preview, needsContext, planBounds }) {
  const spec = preview.spec;
  const fields = Array.isArray(spec.fields) ? spec.fields : [];
  const cadence = spec.composed?.cadence || null;
  const prompt = spec.composed?.prompt || null;
  const tiers = spec.tiers || null;
  const unrepresented = Array.isArray(preview.unrepresented) ? preview.unrepresented : [];
  const autoCount = fields.filter(isAutoField).length;

  return (
    <div className="flex flex-col gap-3">
      {/* Same "we weren't sure" family as every other unfinished signal — the
          setup questions are a gate, and a gate the user only discovers by
          pressing the primary button is a gate they experience as a bug. */}
      {needsContext ? (
        <WarnBanner>
          {autoCount > 0
            ? `${autoCount} field${autoCount === 1 ? "" : "s"} fill${autoCount === 1 ? "s" : ""} automatically from your repository — but we still need to know which repository. Answer the setup questions before submitting.`
            : "This tracker needs a few setup answers before it can be submitted."}
        </WarnBanner>
      ) : null}

      {preview.seeded ? (
        <WarnBanner>
          The AI couldn&apos;t parse specific fields, so this is a generic tracker.
          Re-describe with the exact things you&apos;d log for a better fit.
        </WarnBanner>
      ) : null}

      {/* Phase 1 feeds one flat COMPOSED spec, so a multi-phase plan genuinely
          can't fit. Listing what fell out is what keeps that honest. */}
      {unrepresented.length > 0 ? (
        <WarnBanner>
          <div className="mb-1 font-bold">
            {unrepresented.length} part{unrepresented.length === 1 ? "" : "s"} of your
            document didn&apos;t fit this tracker
          </div>
          {unrepresented.map((item, i) => (
            <div key={i}>· {item}</div>
          ))}
          <div className="mt-1">
            A tracker logs one set of fields per period — anything that needed its
            own week-by-week content or a weighted score is listed above. Track it
            elsewhere, or re-describe to prioritise it.
          </div>
        </WarnBanner>
      ) : null}

      {/* The cycle, in plain terms, before anything else about the tracker.
          A document-derived plan is wrong about its LENGTH far more often
          than about its fields, and "53 weeks" is instantly recognisable as
          wrong to the person who wrote the plan — where "weekly record"
          tells them nothing. A length nobody stated is flagged in the same
          lemon voice as every other uncertainty here. */}
      {planBounds ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={planBounds.lengthSource === "default" ? "lemon" : "lav"}>
            {describeCycle(planBounds)}
          </Badge>
          {planBounds.lengthSource === "default" ? (
            <span className="text-[12.5px] text-lemon-ink">
              No length was stated, so this is a full year. Check the plan to set it.
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Badge tone="lav">{cadence ? `${cadence} record` : "Single record"}</Badge>
        {prompt ? (
          <span className="min-w-0 truncate text-[12.5px] text-muted-fg" title={prompt}>
            {prompt}
          </span>
        ) : null}
      </div>

      <div>
        <Label className="mb-1.5 block">
          {autoCount > 0 && autoCount < fields.length
            ? `You'll log ${fields.length - autoCount} field${fields.length - autoCount === 1 ? "" : "s"} each ${cadence || "time"} — ${autoCount} fill${autoCount === 1 ? "s" : ""} automatically`
            : autoCount > 0 && autoCount === fields.length
              ? `All ${fields.length} field${fields.length === 1 ? "" : "s"} fill automatically`
              : `You'll log ${fields.length} field${fields.length === 1 ? "" : "s"} each ${cadence || "time"}`}
        </Label>
        <div className="flex flex-col gap-1.5">
          {fields.map((f) => {
            const auto = isAutoField(f);
            // The registry sentence, not the raw template id: "checks that
            // AGENTS.md exists in owner/repo" is something the user can agree
            // or disagree with, whereas "repo_file_exists" is something they
            // can only accept.
            const sentence = auto ? describeSource(f.source) : null;
            return (
              <div key={f.id} className="flex flex-col gap-0.5 rounded-[var(--radius-lg)] bg-card-alt px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[13px] text-fg" title={f.label}>
                    {f.label}
                    {f.unit ? <span className="text-dim-fg"> ({f.unit})</span> : null}
                  </span>
                  {auto ? (
                    <Badge tone="lav">Auto · read-only</Badge>
                  ) : (
                    <span className="shrink-0 text-[11.5px] font-semibold text-dim-fg">
                      {f.target
                        ? `${FIELD_KIND_HINT[f.kind] || f.kind} · ${f.target.op}${f.target.value}`
                        : FIELD_KIND_HINT[f.kind] || f.kind}
                    </span>
                  )}
                </div>
                {sentence ? (
                  <span className="text-[12px] leading-[1.45] text-muted-fg">{sentence}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {tiers ? (
        <div>
          <Label className="mb-1.5 block">Achievement tiers</Label>
          <div className="flex flex-col gap-1 text-[13px] leading-[1.45]">
            {[
              ["Achieved", tiers.achieved],
              ["Over-achieved", tiers.overAchieved],
              ["Role model", tiers.roleModel],
            ]
              .filter(([, v]) => v)
              .map(([label, v]) => (
                <div key={label}>
                  <span className="mr-1.5 text-[12px] font-semibold text-muted-fg">{label}</span>
                  <span className="text-fg">{v}</span>
                </div>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

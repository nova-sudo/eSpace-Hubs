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
 * in the same amber banner family as the long-standing `seeded` warning — one
 * visual vocabulary for "the AI wasn't sure / couldn't carry this", never two.
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

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { FileText, Paperclip, X } from "lucide-react";
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
import { useIsContextComplete } from "@/features/goal-context";
import { ContextCollector } from "./state-shells/context-collector";
import { WidgetErrorBoundary } from "./widget-error-boundary";
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
  [PHASE.CONTEXT]: "A few answers are needed before this tracker can read your repository.",
};

const ACCEPTED_EXTENSIONS = ATTACHMENT_ACCEPT.split(",");

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
  const [preview, setPreview] = useState(null); // { spec, seeded, unrepresented }
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
      // and re-extract, and the only way out is spotting the chip's ✕.
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
    const pendingSpec = {
      ...preview.spec,
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
    // A fresh tracker replaces whatever widget was here — wipe the old
    // logged history + settle-locks so it starts clean (same as re-analyze).
    clearGoalEntries(goalId);
    clearGoalLocks(goalId);

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
      toast.success("Custom tracker created.");
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
            onClick={requestClose}
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
                // completeness hook has already flipped. Going back to PREVIEW
                // unconditionally is safe: if something is still blank,
                // `needsContext` keeps the primary button pointing right back
                // here rather than letting an unresolvable tracker through.
                setError(null);
                setPhase(PHASE.PREVIEW);
              }}
            />
          ) : phase === PHASE.PREVIEW && preview?.spec ? (
            <SpecPreview preview={preview} needsContext={needsContext} />
          ) : phase === PHASE.EXTRACTING ? (
            <ExtractingPanel filename={file?.name} />
          ) : phase === PHASE.EXTRACT_REVIEW ? (
            <ExtractReview
              headingRef={reviewHeadingRef}
              extracted={extracted}
              text={extractText}
              onChange={setExtractText}
            />
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
                disabled={busy}
                rows={5}
                autoFocus
                placeholder={
                  file
                    ? "Add anything the document doesn't cover (optional)."
                    : 'e.g. "Each quarter I want to log how many chapters I read — target 5 — plus a short note on what I read."'
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
          {phase === PHASE.CONTEXT ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setPhase(PHASE.PREVIEW);
                }}
                className="uppercase tracking-[0.5px] transition-opacity hover:opacity-80"
                style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--muted-fg)", background: "transparent" }}
              >
                ← Back to tracker
              </button>
              {/* No primary action here on purpose: the collector owns its own
                  submit, and a second "done" button beside it would be two
                  controls for one intent — one of which wouldn't commit the
                  answers. */}
              <span
                className="uppercase tracking-[0.4px]"
                style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--dim-fg)" }}
              >
                Answers save with the form above
              </span>
            </>
          ) : phase === PHASE.PREVIEW ? (
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
                onClick={
                  needsContext
                    ? () => {
                        setError(null);
                        setPhase(PHASE.CONTEXT);
                      }
                    : handleUse
                }
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
                {saving
                  ? "Submitting…"
                  : needsContext
                    ? "Set up auto-fill →"
                    : "Submit for approval →"}
              </button>
            </>
          ) : phase === PHASE.EXTRACTING ? (
            <>
              <button
                type="button"
                onClick={() => extractAbortRef.current?.abort()}
                className="uppercase tracking-[0.5px] transition-opacity hover:opacity-80"
                style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--muted-fg)", background: "transparent" }}
              >
                Cancel upload
              </button>
              <button
                type="button"
                disabled
                className="rounded-[var(--radius-sub)] px-4 py-2 font-bold uppercase"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.5px",
                  color: "var(--accent-on)",
                  background: "var(--accent)",
                  border: "1px solid var(--accent)",
                  opacity: 0.55,
                  cursor: "wait",
                }}
              >
                Reading…
              </button>
            </>
          ) : phase === PHASE.EXTRACT_REVIEW ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setPhase(PHASE.INPUT);
                  setError(null);
                }}
                className="uppercase tracking-[0.5px] transition-opacity hover:opacity-80"
                style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--muted-fg)", background: "transparent" }}
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={extractText.trim().length === 0}
                className="rounded-[var(--radius-sub)] px-4 py-2 font-bold uppercase transition-[filter] hover:brightness-110"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.5px",
                  color: "var(--accent-on)",
                  background: "var(--accent)",
                  border: "1px solid var(--accent)",
                  opacity: extractText.trim().length === 0 ? 0.55 : 1,
                }}
              >
                Looks good →
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={requestClose}
                className="uppercase tracking-[0.5px] transition-opacity hover:opacity-80"
                style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--muted-fg)", background: "transparent" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={busy || !canGenerate}
                className="rounded-[var(--radius-sub)] px-4 py-2 font-bold uppercase transition-[filter] hover:brightness-110"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.5px",
                  color: "var(--accent-on)",
                  background: "var(--accent)",
                  border: "1px solid var(--accent)",
                  opacity: busy || !canGenerate ? 0.55 : 1,
                  cursor: busy ? "wait" : "pointer",
                }}
              >
                {busy ? "Designing…" : "Generate tracker →"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Amber "we weren't sure" banner. Every uncertainty signal in this modal —
 * the AI fell back to a generic tracker, part of a document didn't fit, the
 * extractor flattened something — renders through this one component so users
 * learn a single visual vocabulary instead of three.
 */
function WarnBanner({ children }) {
  return (
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
 * composer). `variant="dark"` matches the modal's card surface — the inverse
 * theme belongs to the indigo analyst section, not here.
 */
function ContextPanel({ spec, goal, onSaved }) {
  const count = spec.context?.questions?.length || 0;
  // Bumped on "try again" to remount the collector after a crash — its draft
  // state is local, so a fresh mount is the only way back to a usable form.
  const [retryKey, setRetryKey] = useState(0);
  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 15, letterSpacing: "-0.2px" }}>
          {count === 1 ? "One thing we need from you" : `${count} things we need from you`}
        </h2>
        <div
          className="mt-1"
          style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--dim-fg)", lineHeight: 1.5 }}
        >
          Some fields fill themselves from your repository. We can&apos;t guess
          which repo you mean, so answer these once and every automatic field
          reuses them.
        </div>
      </div>
      {/* Unlike the mounted-widget body, this had no error boundary — a bug in
          a single question's save path took down the whole modal instead of
          just this panel. */}
      <WidgetErrorBoundary onRetry={() => setRetryKey((k) => k + 1)}>
        <ContextCollector
          key={retryKey}
          spec={spec}
          goal={goal}
          variant="dark"
          onSaved={onSaved}
        />
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
      className={cn(
        "mt-2 flex w-full items-center justify-center gap-2 rounded-[var(--radius-sub)] border border-dashed px-3 py-2.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        over ? "border-accent bg-accent-dim" : "border-border-strong bg-card-alt hover:border-accent",
      )}
    >
      <Paperclip className="h-3.5 w-3.5 text-accent" />
      <span
        className="uppercase tracking-[0.4px]"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted-fg)" }}
      >
        Attach a plan — PDF · DOCX · XLSX · XLS · CSV, up to 10 MB
      </span>
    </button>
  );
}

/** The attached file, as an explicit chip with a real, labelled remove control. */
function FileChip({ file, read, onRemove, disabled }) {
  return (
    <div
      className="mt-2 flex items-center gap-2 rounded-[var(--radius-sub)] px-2.5 py-2"
      style={{ background: "var(--card-alt)", border: "1px solid var(--border)" }}
    >
      <FileText className="h-3.5 w-3.5 shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate" style={{ fontFamily: "var(--font-sans)", fontSize: 12.5 }} title={file.name}>
        {file.name}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--dim-fg)" }}>
        {read ? `read · ${formatBytes(file.size)}` : formatBytes(file.size)}
      </span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${file.name}`}
        className="shrink-0 rounded-full p-1 text-dim-fg transition-colors hover:text-fg disabled:opacity-50"
      >
        <X className="h-3.5 w-3.5" />
      </button>
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
      <FileText className="h-5 w-5 animate-pulse text-accent" />
      <div style={{ fontFamily: "var(--font-display)", fontSize: 15, letterSpacing: "-0.2px" }}>
        Reading your document…
      </div>
      {filename ? (
        <div className="max-w-full truncate" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted-fg)" }} title={filename}>
          {filename}
        </div>
      ) : null}
      <div
        className="max-w-[380px]"
        style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--dim-fg)", lineHeight: 1.55 }}
      >
        We pull the text out on the server and throw the file away — it's never
        stored. You'll get to read and edit the text before anything is sent to
        the AI.
      </div>
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
  // Neutral "what I read" counts. Kept out of the amber banner deliberately:
  // the extractors emit one of these on every successful run, so routing them
  // through WarnBanner would make the warning state fire 100% of the time and
  // stop carrying any signal by the time a real one (a dropped table, a
  // skipped sheet) appears.
  const info = extracted?.info || [];
  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="outline-none"
          style={{ fontFamily: "var(--font-display)", fontSize: 15, letterSpacing: "-0.2px" }}
        >
          Here's what we read
        </h2>
        <div
          className="mt-1"
          style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--dim-fg)", lineHeight: 1.5 }}
        >
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
            <div key={i}>⚠ {w}</div>
          ))}
        </WarnBanner>
      ) : null}

      {info.length > 0 ? (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            color: "var(--dim-fg)",
            lineHeight: 1.6,
          }}
        >
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
        className="w-full rounded-[var(--radius-sub)] p-2.5 outline-none focus:border-accent"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          lineHeight: 1.55,
          color: "var(--fg)",
          background: "var(--card-alt)",
          border: "1px solid var(--border)",
          resize: "vertical",
        }}
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

/** Read-only preview of the generated COMPOSED spec: cadence + fields + tiers. */
function SpecPreview({ preview, needsContext }) {
  const spec = preview.spec;
  const fields = Array.isArray(spec.fields) ? spec.fields : [];
  const cadence = spec.composed?.cadence || null;
  const prompt = spec.composed?.prompt || null;
  const tiers = spec.tiers || null;
  const unrepresented = Array.isArray(preview.unrepresented) ? preview.unrepresented : [];
  const autoCount = fields.filter(isAutoField).length;

  return (
    <div className="flex flex-col gap-3">
      {/* Same amber family as every other "this isn't finished" signal — the
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
          <div className="mb-1 font-bold uppercase tracking-[0.4px]">
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
          {autoCount > 0 && autoCount < fields.length
            ? `You'll log ${fields.length - autoCount} field${fields.length - autoCount === 1 ? "" : "s"} each ${cadence || "time"} — ${autoCount} fill${autoCount === 1 ? "s" : ""} automatically`
            : autoCount > 0 && autoCount === fields.length
              ? `All ${fields.length} field${fields.length === 1 ? "" : "s"} fill automatically`
              : `You'll log ${fields.length} field${fields.length === 1 ? "" : "s"} each ${cadence || "time"}`}
        </div>
        <div className="flex flex-col gap-1.5">
          {fields.map((f) => {
            const auto = isAutoField(f);
            // The registry sentence, not the raw template id: "checks that
            // AGENTS.md exists in owner/repo" is something the user can agree
            // or disagree with, whereas "repo_file_exists" is something they
            // can only accept.
            const sentence = auto ? describeSource(f.source) : null;
            return (
              <div
                key={f.id}
                className="flex flex-col gap-0.5 rounded-[var(--radius-sub)] px-2.5 py-1.5"
                style={{ background: "var(--card-alt)", border: "1px solid var(--border)" }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate" style={{ fontFamily: "var(--font-sans)", fontSize: 13 }} title={f.label}>
                    {f.label}
                    {f.unit ? (
                      <span style={{ color: "var(--dim-fg)" }}> ({f.unit})</span>
                    ) : null}
                  </span>
                  <span
                    className="shrink-0 uppercase"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 9,
                      color: auto ? "var(--accent)" : "var(--dim-fg)",
                      letterSpacing: "0.4px",
                    }}
                  >
                    {auto
                      ? "auto · read-only"
                      : f.target
                        ? `${KIND_HINT[f.kind] || f.kind} · ${f.target.op}${f.target.value}`
                        : KIND_HINT[f.kind] || f.kind}
                  </span>
                </div>
                {sentence ? (
                  <span
                    style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--dim-fg)", lineHeight: 1.45 }}
                  >
                    {sentence}
                  </span>
                ) : null}
              </div>
            );
          })}
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

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

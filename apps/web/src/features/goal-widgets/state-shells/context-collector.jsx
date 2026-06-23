"use client";

import { useState } from "react";
import { Select } from "@/components/ui";
import { WidgetShell } from "../widget-shell";
import { useGoalContext } from "@/features/goal-context";

/**
 * Renders in place of a widget when `spec.context.required` and not all
 * required answers are present.
 *
 * Captures the user-defined truths (e.g. "agreed quality standards") into
 * the goal-context store. As soon as every question is answered, the
 * resolver swaps back to the real widget automatically — no page reload,
 * no explicit "save and render" click.
 *
 * UI contract: stays visually consistent with every other widget tile.
 * Inputs are inverse-themed on section 5 / analyst page (`variant="light"`)
 * and default-themed on a regular dashboard tile (`variant="dark"`).
 *
 * Phase C: when `onReclassify` is provided, an opt-in
 * "Re-analyze with these answers" button appears next to "Save".
 * Clicking it commits the draft AND triggers a single-goal
 * classifier run with the answers folded into the prompt — the
 * classifier can then pick a different widget if the user's
 * definitions point somewhere else.
 */
export function ContextCollector({
  spec,
  goal,
  variant = "light",
  className,
  onRetry,
  onSaved,
  onReclassify,
}) {
  const { answers, setAnswers } = useGoalContext(spec.goalId);
  const questions = spec.context?.questions || [];
  // Local draft — persist only on blur / submit so every keystroke doesn't
  // fire a localStorage write.
  const [draft, setDraft] = useState(() => seedDraft(questions, answers));
  // Re-analysis state. `busy` disables both buttons; `reclassifyError`
  // shows a one-line inline message under the form on failure (e.g.
  // upstream provider error). On success we just hand off to onSaved()
  // — the parent will swap the widget body to the (possibly different)
  // new widget.
  const [busy, setBusy] = useState(false);
  const [reclassifyError, setReclassifyError] = useState(null);
  // W2: walk the questions one at a time instead of one big form, so the
  // collector reads like a short interview. Single-question goals collapse
  // to one step.
  const [step, setStep] = useState(0);
  const lastStep = Math.max(0, questions.length - 1);
  const activeStep = Math.min(step, lastStep);
  const onLastStep = activeStep >= lastStep;

  function update(id, value) {
    setDraft((d) => ({ ...d, [id]: value }));
  }

  /**
   * Persist the draft. Called on blur (silent — the user is still
   * editing) AND on explicit submit (the "Save answers" button — the
   * user's "I'm done" signal). Only the submit path notifies the
   * parent via `onSaved`, so tabbing between fields doesn't
   * accidentally close the form.
   */
  function commit() {
    const normalized = normalizeAnswers(questions, draft);
    setAnswers(normalized);
    return normalized;
  }

  async function handleReclassify() {
    if (!onReclassify || busy) return;
    setReclassifyError(null);
    setBusy(true);
    try {
      // Build the Q/A pairs from the DRAFT without persisting yet.
      // Persisting (setAnswers) flips useIsContextComplete → true, which
      // makes GoalWidget unmount this collector mid-await; deferring the
      // commit until AFTER the classifier resolves keeps us mounted so the
      // busy state + error banner stay reliable.
      const normalized = normalizeAnswers(questions, draft);
      const pairs = buildAnswerPairs(questions, normalized);
      await onReclassify(pairs);
      // Success: persist the answers, then hand off — the parent saved the
      // new spec, so the widget body now renders whatever the classifier
      // chose this time.
      setAnswers(normalized);
      onSaved?.();
    } catch (err) {
      setReclassifyError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  // When a reclassify path is wired, keep every answer in the local `draft`
  // and persist (setAnswers) ONLY after the classifier resolves. Persisting
  // early — on blur or on a select change — flips useIsContextComplete → true,
  // which makes GoalWidget unmount this collector before the re-analyze can
  // run (the reported "answers ignored" bug). Without a reclassify path (the
  // Review pane) we keep the original save-on-blur behaviour.
  const persistOnBlur = onReclassify ? undefined : commit;

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label="Define before tracking"
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
    >
      <form
        className="flex h-full flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          // Wizard: advance to the next question until the last, then submit.
          if (!onLastStep) {
            // Persist progress between steps only when we're NOT going to
            // re-analyze — on the reclassify path the draft is the source of
            // truth and persisting early would unmount the collector.
            if (!onReclassify) commit();
            setStep(activeStep + 1);
            return;
          }
          // Final step. With a reclassify path wired, saving re-runs the
          // classifier so the freshly-defined truths re-scope the spec/tiers.
          // Without one (Review pane), just persist and hand control back.
          if (onReclassify) {
            void handleReclassify();
          } else {
            commit();
            onSaved?.();
          }
        }}
      >
        <div
          className="flex items-center justify-between gap-2"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: variant === "light" ? "rgba(255,255,255,0.72)" : "var(--muted-fg)",
            lineHeight: 1.45,
          }}
        >
          <span>Define before tracking</span>
          {questions.length > 1 ? (
            <span style={{ opacity: 0.8 }}>
              {activeStep + 1} / {questions.length}
            </span>
          ) : null}
        </div>
        <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto pr-1">
          {questions[activeStep] ? (
            <QuestionField
              key={questions[activeStep].id}
              question={questions[activeStep]}
              value={draft[questions[activeStep].id]}
              onChange={(v) => update(questions[activeStep].id, v)}
              onBlur={persistOnBlur}
              variant={variant}
            />
          ) : null}
        </div>
        {reclassifyError ? (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: variant === "light" ? "#ffd5d5" : "var(--danger)",
              lineHeight: 1.4,
            }}
          >
            Re-analyze failed: {reclassifyError}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {activeStep > 0 ? (
            <button
              type="button"
              onClick={() => setStep(activeStep - 1)}
              disabled={busy}
              className="uppercase tracking-[0.5px]"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: variant === "light" ? "rgba(255,255,255,0.72)" : "var(--muted-fg)",
              }}
            >
              ← Back
            </button>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="rounded-[var(--radius-sub)] px-3 py-1.5 font-bold uppercase transition-opacity"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              letterSpacing: "0.5px",
              background:
                variant === "light" ? "#ffffff" : "var(--accent)",
              color:
                variant === "light" ? "var(--accent)" : "var(--accent-on)",
              opacity: busy ? 0.55 : 1,
              cursor: busy ? "not-allowed" : "pointer",
            }}
            title={
              onReclassify
                ? "Save your answers and re-run the AI classifier so it re-scopes this goal to your definitions (it may even pick a different widget)."
                : undefined
            }
          >
            {!onLastStep
              ? "Next →"
              : onReclassify
                ? busy
                  ? "Saving & re-analyzing…"
                  : "Save & re-analyze"
                : "Save answers"}
          </button>
        </div>
      </form>
    </WidgetShell>
  );
}

/**
 * Build the Q→A pairs the classifier sees on the prompt. Each entry
 * pairs the human-readable question text with a single serialised
 * string answer (lists are joined with newlines so the prompt formatter
 * can render them as nested bullets). Empty answers are filtered out
 * so the prompt doesn't show "  • What's your standard?\n      "
 * lines that confuse the model.
 */
function buildAnswerPairs(questions, normalizedAnswers) {
  const out = [];
  for (const q of questions) {
    const raw = normalizedAnswers[q.id];
    const answer = serializeAnswer(raw, q.kind);
    if (!answer) continue;
    out.push({
      prompt: q.prompt,
      answer,
    });
  }
  return out;
}

function serializeAnswer(value, kind) {
  if (value == null) return "";
  if (kind === "list" || kind === "resource_link") {
    return Array.isArray(value)
      ? value.map((s) => String(s).trim()).filter(Boolean).join("\n")
      : "";
  }
  if (kind === "number") {
    return typeof value === "number" && !Number.isNaN(value)
      ? String(value)
      : "";
  }
  return typeof value === "string" ? value.trim() : "";
}

function QuestionField({ question: q, value, onChange, onBlur, variant }) {
  const labelStyle = {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    letterSpacing: "0.5px",
    color: variant === "light" ? "rgba(255,255,255,0.72)" : "var(--muted-fg)",
  };
  const inputStyle = {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: variant === "light" ? "#ffffff" : "var(--fg)",
    background: variant === "light" ? "rgba(255,255,255,0.08)" : "var(--card-alt)",
    border:
      variant === "light"
        ? "1px solid rgba(255,255,255,0.22)"
        : "1px solid var(--border)",
    borderRadius: "var(--radius-sub)",
    padding: "6px 8px",
    width: "100%",
    outline: "none",
  };

  return (
    <label className="flex flex-col gap-1">
      <span className="uppercase" style={labelStyle}>
        {q.prompt}
      </span>
      {q.kind === "text" ? (
        <input
          type="text"
          value={typeof value === "string" ? value : ""}
          placeholder={q.placeholder || ""}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          style={inputStyle}
        />
      ) : q.kind === "number" ? (
        <input
          type="number"
          value={typeof value === "number" ? value : ""}
          placeholder={q.placeholder || ""}
          onChange={(e) => {
            const n = e.target.value === "" ? "" : Number(e.target.value);
            onChange(n);
          }}
          onBlur={onBlur}
          style={inputStyle}
        />
      ) : q.kind === "list" ? (
        <textarea
          rows={3}
          value={Array.isArray(value) ? value.join("\n") : typeof value === "string" ? value : ""}
          placeholder={q.placeholder || "One item per line"}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      ) : q.kind === "resource_link" ? (
        <textarea
          rows={3}
          value={Array.isArray(value) ? value.join("\n") : typeof value === "string" ? value : ""}
          placeholder={
            q.placeholder ||
            "One link per line — Jira filter, runbook/Confluence, repo, example PRs…"
          }
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      ) : q.kind === "select" ? (
        <Select
          value={typeof value === "string" ? value : ""}
          onChange={(e) => {
            onChange(e.target.value);
            // Selects commit immediately — but only when save-on-blur is
            // active (no reclassify path). On the reclassify path onBlur is
            // undefined so the draft holds the value until re-analyze runs.
            if (onBlur) setTimeout(onBlur, 0);
          }}
          tone={variant === "light" ? "inverse" : "default"}
          size="sm"
          className="w-full"
        >
          <option value="">—</option>
          {(q.options || []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </Select>
      ) : null}
    </label>
  );
}

function seedDraft(questions, answers) {
  const draft = {};
  for (const q of questions) {
    draft[q.id] = answers[q.id] ?? "";
  }
  return draft;
}

function normalizeAnswers(questions, draft) {
  const out = {};
  for (const q of questions) {
    const raw = draft[q.id];
    if (q.kind === "list" || q.kind === "resource_link") {
      // Accept either the stored array or a textarea string.
      const items = Array.isArray(raw)
        ? raw
        : typeof raw === "string"
          ? raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
          : [];
      out[q.id] = items;
    } else if (q.kind === "number") {
      out[q.id] = typeof raw === "number" && !Number.isNaN(raw) ? raw : null;
    } else {
      out[q.id] = typeof raw === "string" ? raw.trim() : "";
    }
  }
  return out;
}

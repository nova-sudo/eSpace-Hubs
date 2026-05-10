"use client";

import { useState } from "react";
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
 */
export function ContextCollector({
  spec,
  goal,
  variant = "light",
  className,
  onRetry,
  onSaved,
}) {
  const { answers, setAnswers } = useGoalContext(spec.goalId);
  const questions = spec.context?.questions || [];
  // Local draft — persist only on blur / submit so every keystroke doesn't
  // fire a localStorage write.
  const [draft, setDraft] = useState(() => seedDraft(questions, answers));

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
  }

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
          commit();
          // After persisting, hand control back to the parent. For
          // GoalWidget this clears its `forceEditContext` override and
          // the actual rubric / counter / scale widget takes the slot
          // back. Without this the view stays pinned to the collector
          // even after a successful save — which looks like "Save
          // did nothing" to the user.
          onSaved?.();
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: variant === "light" ? "rgba(255,255,255,0.72)" : "var(--muted-fg)",
            lineHeight: 1.45,
          }}
        >
          This goal refers to concepts only you (or your team) can define.
          Answer once; the widget will activate after that.
        </div>
        <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto pr-1">
          {questions.map((q) => (
            <QuestionField
              key={q.id}
              question={q}
              value={draft[q.id]}
              onChange={(v) => update(q.id, v)}
              onBlur={commit}
              variant={variant}
            />
          ))}
        </div>
        <button
          type="submit"
          className="self-start rounded-[var(--radius-sub)] px-3 py-1.5 font-bold uppercase transition-opacity"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            letterSpacing: "0.5px",
            background: variant === "light" ? "#ffffff" : "var(--accent)",
            color: variant === "light" ? "var(--accent)" : "var(--accent-on)",
          }}
        >
          Save answers
        </button>
      </form>
    </WidgetShell>
  );
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
      ) : q.kind === "select" ? (
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(e) => {
            onChange(e.target.value);
            // Selects commit immediately — no blur needed.
            setTimeout(onBlur, 0);
          }}
          style={inputStyle}
        >
          <option value="">—</option>
          {(q.options || []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
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
    if (q.kind === "list") {
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

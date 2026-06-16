"use client";

/**
 * COMPOSED — the generative widget interpreter.
 *
 * Renders ANY widget described by a declarative `spec.fields[]` schema (see
 * docs/generative-widget.md). The classifier (or a human) invents the
 * *combination* of fields and the cadence; this one component renders it. No
 * code is generated or executed — a "new widget type" is just data, so it's
 * safe, gradeable, and survives without a build.
 *
 * Storage: the whole record lives in ONE evolving goal-inputs entry —
 *   { values: { [fieldId]: value }, evidence: { [fieldId]: string } }
 * Each edit appends a merged snapshot (append-only store, latest wins). Every
 * field can carry optional evidence (a note, link, or measured value) which
 * `useGoalTier.buildCurrentData` folds into the grader's view — so a generated
 * widget closes the same spec↔data↔grader loop the hand-written ones do.
 *
 * v1 is non-resetting (one running record). Period-reset per cadence is the
 * documented v2 (mirrors RECURRING_MILESTONE's per-period entries).
 */

import { useMemo } from "react";
import { WidgetShell } from "../widget-shell";
import { useGoalInputs } from "@/features/goal-inputs";
import { ItemEvidence } from "./_milestone-evidence.jsx";

function hasValue(v, kind) {
  if (kind === "checkbox") return v === true;
  return v != null && v !== "";
}

export function ComposedWidget({ spec, goal, variant = "light", className, onRetry }) {
  const { latest, append } = useGoalInputs(goal?.id);
  const fields = Array.isArray(spec.fields) ? spec.fields : [];
  const cadence = spec.composed?.cadence || null;
  const promptCopy =
    spec.composed?.prompt || "Track this goal's data below.";

  const record = useMemo(
    () => (latest?.value && typeof latest.value === "object" ? latest.value : {}),
    [latest],
  );
  const values =
    record.values && typeof record.values === "object" ? record.values : {};
  const evidence =
    record.evidence && typeof record.evidence === "object" ? record.evidence : {};

  const isLight = variant === "light";
  const muted = isLight ? "rgba(255,255,255,0.68)" : "var(--muted-fg)";
  const fg = isLight ? "#ffffff" : "var(--fg)";
  const fieldBg = isLight ? "rgba(255,255,255,0.10)" : "var(--bg)";
  const fieldBorder = isLight
    ? "1px solid rgba(255,255,255,0.22)"
    : "1px solid var(--border)";

  function write(nextValues, nextEvidence) {
    append({ values: nextValues, evidence: nextEvidence });
  }
  function setValue(id, v) {
    write({ ...values, [id]: v }, evidence);
  }
  function setEvidence(id, text) {
    const ne = { ...evidence };
    if (text) ne[id] = text;
    else delete ne[id];
    write(values, ne);
  }

  const filled = fields.filter((f) => hasValue(values[f.id], f.kind)).length;
  const total = fields.length;
  const pct = total ? Math.round((filled / total) * 100) : 0;

  const inputStyle = {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: fg,
    background: fieldBg,
    border: fieldBorder,
    borderRadius: "var(--radius-sub)",
    padding: "4px 7px",
    outline: "none",
    width: "100%",
    minWidth: 0,
  };

  function control(f) {
    const v = values[f.id];
    switch (f.kind) {
      case "checkbox":
        return (
          <input
            type="checkbox"
            checked={v === true}
            onChange={() => setValue(f.id, v !== true)}
            className="h-3.5 w-3.5 shrink-0"
          />
        );
      case "counter": {
        const n = Number.isFinite(Number(v)) ? Number(v) : 0;
        return (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setValue(f.id, Math.max(0, n - 1))}
              style={{ ...inputStyle, width: 26, textAlign: "center", cursor: "pointer" }}
              aria-label={`decrease ${f.label}`}
            >
              −
            </button>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: fg, minWidth: 28, textAlign: "center" }}>
              {n}
              {f.unit ? <span style={{ fontSize: 9.5, color: muted }}> {f.unit}</span> : null}
            </span>
            <button
              type="button"
              onClick={() => setValue(f.id, n + 1)}
              style={{ ...inputStyle, width: 26, textAlign: "center", cursor: "pointer" }}
              aria-label={`increase ${f.label}`}
            >
              +
            </button>
          </div>
        );
      }
      case "scale":
        return (
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setValue(f.id, n)}
                style={{
                  ...inputStyle,
                  width: 26,
                  textAlign: "center",
                  cursor: "pointer",
                  background: Number(v) === n ? (isLight ? "#ffffff" : "var(--accent)") : fieldBg,
                  color: Number(v) === n ? (isLight ? "var(--accent)" : "var(--accent-on)") : fg,
                }}
              >
                {n}
              </button>
            ))}
          </div>
        );
      case "number":
        return (
          <input
            type="number"
            value={v ?? ""}
            onChange={(e) =>
              setValue(f.id, e.target.value === "" ? "" : Number(e.target.value))
            }
            placeholder={f.unit ? f.unit : "value"}
            style={{ ...inputStyle, width: 110 }}
          />
        );
      case "date":
        return (
          <input
            type="date"
            value={typeof v === "string" ? v : ""}
            onChange={(e) => setValue(f.id, e.target.value)}
            style={{ ...inputStyle, width: 150 }}
          />
        );
      case "select":
        return (
          <select
            value={typeof v === "string" ? v : ""}
            onChange={(e) => setValue(f.id, e.target.value)}
            style={{ ...inputStyle, width: "auto", minWidth: 120 }}
          >
            <option value="">—</option>
            {(f.options || []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );
      case "link":
        return (
          <input
            type="url"
            value={typeof v === "string" ? v : ""}
            onChange={(e) => setValue(f.id, e.target.value)}
            placeholder="https://…"
            style={inputStyle}
          />
        );
      case "text":
      default:
        return (
          <input
            type="text"
            value={typeof v === "string" ? v : ""}
            onChange={(e) => setValue(f.id, e.target.value)}
            placeholder={f.help || "…"}
            style={inputStyle}
          />
        );
    }
  }

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={`Composed · ${filled}/${total}${cadence ? ` · ${cadence}` : ""}`}
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <div
            className="font-semibold leading-none"
            style={{ fontFamily: "var(--font-display)", fontSize: 32, letterSpacing: "-1.2px" }}
          >
            {pct}%
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: muted }}>
            {filled}/{total} captured
          </div>
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: muted }}>
          {promptCopy}
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {fields.length === 0 ? (
            <div style={{ fontSize: 11, color: muted }}>
              No fields defined for this widget yet.
            </div>
          ) : null}
          {fields.map((f) => (
            <div key={f.id} className="flex min-w-0 flex-col gap-1">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span
                  className="min-w-0 flex-1 truncate"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: muted }}
                  title={f.label}
                >
                  {f.label}
                  {f.optional ? <span style={{ opacity: 0.6 }}> (optional)</span> : null}
                </span>
                {f.kind === "checkbox" ? control(f) : null}
              </div>
              {f.kind === "checkbox" ? null : (
                <div className="min-w-0">{control(f)}</div>
              )}
              {/* Per-field evidence — the proof the grader reads. Skip for
                  `link` fields (the value IS the evidence). */}
              {f.kind === "link" ? null : (
                <div className="min-w-0">
                  <ItemEvidence
                    value={evidence[f.id]}
                    variant={variant}
                    onSave={(t) => setEvidence(f.id, t)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </WidgetShell>
  );
}

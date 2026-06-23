"use client";

/**
 * ComposedFields — the field body of a COMPOSED widget, scoped to ONE period.
 *
 * Shared by the COMPOSED widget (renders the CURRENT period) and the cadence
 * stepper (renders a SELECTED past/current period for backfill). Period-aware:
 * each entry is `{ periodKey, values, evidence }`, so a quarterly COMPOSED goal
 * resets every quarter and you can fill any quarter independently. `periodKey`
 * is null for non-bucketing / cadence-less goals (one running record).
 *
 * Reads/writes the goal-inputs store directly; renders one control per field
 * kind plus optional per-field evidence.
 */

import { useMemo } from "react";
import { useGoalInputs } from "@/features/goal-inputs";
import { Select, Checkbox, ItemEvidence } from "@/components/ui";

function hasValue(v, kind) {
  if (kind === "checkbox") return v === true;
  return v != null && v !== "";
}

export function ComposedFields({ goalId, fields, periodKey = null, writeTs = null, variant = "light", showHeadline = true }) {
  const { entries, append } = useGoalInputs(goalId);
  const list = Array.isArray(fields) ? fields : [];

  const record = useMemo(() => {
    const all = entries || [];
    const matching = all.filter((e) =>
      periodKey == null
        ? e?.value && e.value.periodKey == null
        : e?.value?.periodKey === periodKey,
    );
    const latest = matching[matching.length - 1];
    return latest?.value && typeof latest.value === "object" ? latest.value : {};
  }, [entries, periodKey]);

  const values = record.values && typeof record.values === "object" ? record.values : {};
  const evidence = record.evidence && typeof record.evidence === "object" ? record.evidence : {};

  const isLight = variant === "light";
  const tone = isLight ? "inverse" : "default";
  const muted = isLight ? "rgba(255,255,255,0.68)" : "var(--muted-fg)";
  const fg = isLight ? "#ffffff" : "var(--fg)";
  const fieldBg = isLight ? "rgba(255,255,255,0.10)" : "var(--bg)";
  const fieldBorder = isLight ? "1px solid rgba(255,255,255,0.22)" : "1px solid var(--border-strong)";

  function write(nextValues, nextEvidence) {
    const payload = { values: nextValues, evidence: nextEvidence };
    if (periodKey != null) payload.periodKey = periodKey;
    // Stamp the entry inside the period being filled (writeTs = period midpoint
    // when backfilling a past window from the stepper). Without this, append
    // defaults to Date.now() and a backfilled quarter lands in the CURRENT
    // window — so the stepper never marks that past period filled.
    append(payload, undefined, writeTs ?? undefined);
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

  const filled = list.filter((f) => hasValue(values[f.id], f.kind)).length;
  const total = list.length;

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
          <Checkbox
            checked={v === true}
            onChange={() => setValue(f.id, v !== true)}
          />
        );
      case "counter": {
        const n = Number.isFinite(Number(v)) ? Number(v) : 0;
        return (
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setValue(f.id, Math.max(0, n - 1))} style={{ ...inputStyle, width: 26, textAlign: "center", cursor: "pointer" }} aria-label={`decrease ${f.label}`}>−</button>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: fg, minWidth: 28, textAlign: "center" }}>
              {n}
              {f.unit ? <span style={{ fontSize: 9.5, color: muted }}> {f.unit}</span> : null}
            </span>
            <button type="button" onClick={() => setValue(f.id, n + 1)} style={{ ...inputStyle, width: 26, textAlign: "center", cursor: "pointer" }} aria-label={`increase ${f.label}`}>+</button>
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
          <input type="number" value={v ?? ""} onChange={(e) => setValue(f.id, e.target.value === "" ? "" : Number(e.target.value))} placeholder={f.unit ? f.unit : "value"} style={{ ...inputStyle, width: 110 }} />
        );
      case "date":
        return (
          <input type="date" value={typeof v === "string" ? v : ""} onChange={(e) => setValue(f.id, e.target.value)} style={{ ...inputStyle, width: 150, colorScheme: isLight ? "dark" : "light" }} />
        );
      case "select":
        return (
          <Select
            tone={tone}
            size="sm"
            value={typeof v === "string" ? v : ""}
            onChange={(e) => setValue(f.id, e.target.value)}
            style={{ minWidth: 120 }}
          >
            <option value="">—</option>
            {(f.options || []).map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </Select>
        );
      case "link":
        return (
          <input type="url" value={typeof v === "string" ? v : ""} onChange={(e) => setValue(f.id, e.target.value)} placeholder="https://…" style={inputStyle} />
        );
      case "text":
      default:
        return (
          <input type="text" value={typeof v === "string" ? v : ""} onChange={(e) => setValue(f.id, e.target.value)} placeholder={f.help || "…"} style={inputStyle} />
        );
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {showHeadline ? (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: muted }}>
          {filled}/{total} captured
        </div>
      ) : null}
      {list.length === 0 ? (
        <div style={{ fontSize: 11, color: muted }}>No fields defined for this widget yet.</div>
      ) : null}
      {list.map((f) => (
        <div key={f.id} className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="min-w-0 flex-1 truncate" style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: muted }} title={f.label}>
              {f.label}
              {f.optional ? <span style={{ opacity: 0.6 }}> (optional)</span> : null}
            </span>
            {f.kind === "checkbox" ? control(f) : null}
          </div>
          {f.kind === "checkbox" ? null : <div className="min-w-0">{control(f)}</div>}
          {f.kind === "link" ? null : (
            <div className="min-w-0">
              <ItemEvidence value={evidence[f.id]} variant={variant} onSave={(t) => setEvidence(f.id, t)} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

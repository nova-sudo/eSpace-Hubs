"use client";

/**
 * Optional inline evidence for a checklist item / period — a short note, a
 * link, or a measured value attached to a milestone item or a filled period.
 *
 * The gap this closes: a checklist item could only carry a binary tick, but
 * achievement-tier criteria routinely demand *documented* proof ("scenario
 * documented, measured RTO/RPO, findings"). With nowhere to put that proof the
 * grader judged a bare boolean and defaulted skeptical. The grader folds
 * `item.evidence` into its currentData, so the verdict rests on real evidence.
 *
 * Lives in components/ui (not a feature) so both the dashboard widgets and the
 * cadence-stepper / check-in editors can render it without a cross-feature
 * import cycle. Evidence is a plain string (`item.evidence`), backward
 * compatible (absent on old entries).
 */

import { useState } from "react";

const isUrl = (s) => /^https?:\/\//i.test(String(s).trim());

export function ItemEvidence({ value, onSave, variant = "light" }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");

  const isLight = variant === "light";
  const muted = isLight ? "rgba(255,255,255,0.62)" : "var(--muted-fg)";
  const fg = isLight ? "#ffffff" : "var(--fg)";
  const linkColor = isLight ? "#ffffff" : "var(--accent)";
  const fieldBg = isLight ? "rgba(255,255,255,0.10)" : "var(--bg)";
  const fieldBorder = isLight
    ? "1px solid rgba(255,255,255,0.22)"
    : "1px solid var(--border-strong)";

  function commit() {
    onSave((draft || "").trim());
    setEditing(false);
  }

  if (editing) {
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              setDraft(value || "");
              setEditing(false);
            }
          }}
          onBlur={commit}
          placeholder="note, link, or measured value…"
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: fg,
            background: fieldBg,
            border: fieldBorder,
            borderRadius: "var(--radius-sub)",
            padding: "3px 7px",
            outline: "none",
          }}
        />
      </div>
    );
  }

  if (value) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 10,
          color: muted,
          minWidth: 0,
        }}
      >
        <span style={{ opacity: 0.75, flexShrink: 0 }}>evidence:</span>
        {isUrl(value) ? (
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            title={value}
            style={{
              color: linkColor,
              textDecoration: "underline",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {value}
          </a>
        ) : (
          <span
            title={value}
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: "var(--font-mono)",
            }}
          >
            {value}
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
          aria-label="edit evidence"
          style={{
            flexShrink: 0,
            border: "none",
            background: "transparent",
            color: muted,
            cursor: "pointer",
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
          }}
        >
          edit
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft("");
        setEditing(true);
      }}
      style={{
        border: "none",
        background: "transparent",
        color: muted,
        cursor: "pointer",
        fontFamily: "var(--font-mono)",
        fontSize: 9.5,
        opacity: 0.85,
        padding: 0,
      }}
    >
      + note / link
    </button>
  );
}

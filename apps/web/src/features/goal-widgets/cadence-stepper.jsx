"use client";

/**
 * CadenceStepper — a per-widget gauge of the goal's cycle windows.
 *
 * Phase 1: READ-ONLY. Shows, for a manual widget, whether each cadence window
 * in the review cycle was filled — doubling as a status gauge and (later) the
 * check-in surface. Three adaptive modes from `buildCycleWindows`:
 *   - pip      non-bucketing / no cadence → complete ↔ incomplete
 *   - stepper  ≤13 windows (quarterly = 4, monthly = 12) — labelled cells
 *   - heatmap  many windows (weekly ≈ 52, daily ≈ 365) — compact grid
 *
 * Rendered once per tile from <WidgetShell> for MANUAL-variant widgets. Future
 * phases make cells selectable (pick a window to fill/backfill) and fold in
 * goal-locks "settled" state — at which point this replaces the /checkin page.
 *
 * State is never colour-only (a11y): each cell carries shape + glyph + a
 * `title` tooltip (`Q2 · current`). `prefers-reduced-motion` is respected by
 * using no animation at all here.
 */

import { useMemo, useState } from "react";
import { useGoalInputs, buildCycleWindows } from "@/features/goal-inputs";
import { GoalManualEditor, isInlineFillable } from "@/features/goal-editors";
import { SPEC_KINDS } from "@/features/goal-specs";
import { isLocked, setLock, useGoalLocks } from "@/features/goal-locks";
import { ComposedFields } from "./widgets/composed-fields.jsx";

const STATE_LABEL = {
  filled: "filled",
  owed: "not logged",
  current: "current",
  future: "upcoming",
  settled: "nothing to report",
};

function palette(variant) {
  const light = variant === "light";
  return {
    label: light ? "rgba(255,255,255,0.68)" : "var(--muted-fg)",
    dim: light ? "rgba(255,255,255,0.45)" : "var(--dim-fg)",
    filledBg: light ? "rgba(255,255,255,0.92)" : "var(--accent)",
    filledFg: light ? "#1d4ed8" : "var(--accent-on)",
    currentBorder: light ? "#ffffff" : "var(--accent)",
    currentBg: light ? "rgba(255,255,255,0.16)" : "var(--accent-dim)",
    currentFg: light ? "#ffffff" : "var(--accent)",
    owedBorder: light ? "rgba(255,255,255,0.55)" : "var(--border)",
    owedDot: light ? "rgba(255,255,255,0.85)" : "var(--muted-fg)",
    futureBorder: light ? "rgba(255,255,255,0.22)" : "var(--border)",
  };
}

function Check({ size = 15, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function cellVisual(state, p) {
  switch (state) {
    case "filled":
      return { background: p.filledBg, border: "none", glyph: <Check color={p.filledFg} /> };
    case "current":
      return {
        background: p.currentBg,
        border: `2px solid ${p.currentBorder}`,
        glyph: (
          <span style={{ color: p.currentFg, fontSize: 16, lineHeight: 1 }}>+</span>
        ),
      };
    case "settled":
      return {
        background:
          "repeating-linear-gradient(45deg, rgba(128,128,128,0.18), rgba(128,128,128,0.18) 3px, transparent 3px, transparent 6px)",
        border: `1px solid ${p.futureBorder}`,
        glyph: <span style={{ color: p.dim, fontSize: 13 }}>–</span>,
      };
    case "owed":
      return {
        background: "transparent",
        border: `1.5px dashed ${p.owedBorder}`,
        glyph: <span style={{ width: 5, height: 5, borderRadius: "50%", background: p.owedDot }} />,
      };
    default: // future
      return { background: "transparent", border: `1px solid ${p.futureBorder}`, glyph: null, faint: true };
  }
}

export function CadenceStepper({ spec, variant = "light" }) {
  const goalId = spec?.goalId;
  const { entries } = useGoalInputs(goalId);
  const cadence = spec?.manual?.cadence ?? spec?.composed?.cadence ?? null;
  // Inline-fillable: the shared check-in editors, plus COMPOSED (which fills
  // per-period via its own <ComposedFields> body).
  const isComposed = spec?.widget === SPEC_KINDS.COMPOSED;
  const fillable = isInlineFillable(spec?.widget) || isComposed;
  const goal = useMemo(() => ({ id: goalId, title: spec?.title }), [goalId, spec?.title]);
  // Which window the user opened to fill/backfill (null = none; current period
  // is filled via the widget body above, as before).
  const [selectedKey, setSelectedKey] = useState(null);
  // Subscribe to lock changes so "nothing to report" settles re-render the cells.
  useGoalLocks();

  const data = useMemo(
    () => buildCycleWindows({ entries, cadence, now: Date.now() }),
    [entries, cadence],
  );

  const p = palette(variant);

  if (data.mode === "pip") {
    const done = data.complete;
    return (
      <div className="mt-3 flex items-center gap-2" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: p.label }}>
        <span
          title={done ? "complete" : "not complete"}
          style={{
            width: 18,
            height: 18,
            borderRadius: "50%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: done ? p.filledBg : "transparent",
            border: done ? "none" : `1.5px dashed ${p.owedBorder}`,
          }}
        >
          {done ? <Check size={12} color={p.filledFg} /> : null}
        </span>
        {done ? "complete" : "not completed yet"}
      </div>
    );
  }

  const windows = data.windows || [];
  const selected = selectedKey ? windows.find((w) => w.key === selectedKey) : null;
  const settledOf = (w) =>
    isLocked(goalId, w.key) && w.state !== "filled" && w.state !== "future";

  // Header + inline editor panel are shared by stepper and heatmap modes.
  const header = (
    <div className="mb-1.5 flex items-center justify-between" style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: p.label }}>
      <span style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>{data.cadence} · cycle</span>
      <span>{data.filledCount}/{data.total} filled</span>
    </div>
  );

  const editorPanel = selected ? (
    <div
      className="mt-2 rounded-[var(--radius-sub)] p-2.5"
      style={{ background: "var(--card)", color: "var(--fg)", border: "1px solid var(--border)" }}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--muted-fg)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          logging {selected.label}
        </span>
        <div className="flex items-center gap-3">
          {/* "Nothing to report" settle — the same goal-locks escape hatch the
              check-in had, so a quiet period stops reading as owed. */}
          <button
            type="button"
            onClick={() => setLock(goalId, selected.key, !isLocked(goalId, selected.key))}
            style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--muted-fg)", border: "none", background: "transparent", cursor: "pointer" }}
            title="Settle this period — nothing happened, stop flagging it as owed"
          >
            {isLocked(goalId, selected.key) ? "reopen" : "nothing to report"}
          </button>
          <button
            type="button"
            onClick={() => setSelectedKey(null)}
            style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--muted-fg)", border: "none", background: "transparent", cursor: "pointer" }}
          >
            close
          </button>
        </div>
      </div>
      {isComposed ? (
        <ComposedFields goalId={goalId} fields={spec.fields} periodKey={selected.key} variant="dark" />
      ) : (
        <GoalManualEditor
          widget={spec.widget}
          goal={goal}
          spec={spec}
          weekStart={new Date(selected.start)}
          weekEnd={new Date(selected.end)}
          activeLabel={selected.label}
          writeTs={Math.floor((selected.start + selected.end) / 2)}
        />
      )}
    </div>
  ) : null;

  if (data.mode === "heatmap") {
    return (
      <div className="mt-3">
        {header}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(11px, 1fr))", gap: 3 }}>
          {windows.map((w) => {
            const effState = settledOf(w) ? "settled" : w.state;
            const v = cellVisual(effState, p);
            const isSelected = w.key === selectedKey;
            const canFill = fillable && w.state !== "future";
            const cellStyle = {
              aspectRatio: "1 / 1",
              width: "100%",
              borderRadius: 2,
              background: v.background,
              border: v.border,
              opacity: v.faint ? 0.5 : 1,
              boxShadow: isSelected ? `0 0 0 2px ${p.currentBorder}` : "none",
              padding: 0,
            };
            return canFill ? (
              <button
                key={w.key}
                type="button"
                onClick={() => setSelectedKey(isSelected ? null : w.key)}
                aria-pressed={isSelected}
                aria-label={`${isSelected ? "Close" : "Log"} ${w.label} (${STATE_LABEL[effState]})`}
                title={`${w.label} · ${STATE_LABEL[effState]}`}
                style={{ ...cellStyle, cursor: "pointer" }}
              />
            ) : (
              <div key={w.key} title={`${w.label} · ${STATE_LABEL[effState]}`} style={cellStyle} />
            );
          })}
        </div>
        {editorPanel}
      </div>
    );
  }

  // stepper
  return (
    <div className="mt-3">
      {header}
      <div className="flex items-start gap-1.5">
        {windows.map((w) => {
          // A "nothing to report" lock overlays owed/current windows as settled
          // (filled windows already count; the future can't be settled).
          const settled =
            isLocked(goalId, w.key) && w.state !== "filled" && w.state !== "future";
          const effState = settled ? "settled" : w.state;
          const v = cellVisual(effState, p);
          const isCurrent = w.state === "current";
          const isSelected = w.key === selectedKey;
          // Interactive only for inline-fillable widgets, and only for windows
          // that have started (you can't log the future).
          const canFill = fillable && w.state !== "future";
          const sz = isCurrent ? 40 : 34;
          const cell = (
            <div
              title={`${w.label} · ${STATE_LABEL[effState]}`}
              style={{
                width: "100%",
                maxWidth: sz + 8,
                height: sz,
                borderRadius: 8,
                background: v.background,
                border: v.border,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: v.faint ? 0.45 : 1,
                boxShadow: isSelected
                  ? `0 0 0 2px ${p.currentBorder}`
                  : isCurrent
                    ? `0 0 0 3px ${p.currentBg}`
                    : "none",
              }}
            >
              {v.glyph}
            </div>
          );
          return (
            <div key={w.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              {canFill ? (
                <button
                  type="button"
                  onClick={() => setSelectedKey(isSelected ? null : w.key)}
                  aria-pressed={isSelected}
                  aria-label={`${isSelected ? "Close" : "Log"} ${w.label} (${STATE_LABEL[w.state]})`}
                  style={{ width: "100%", maxWidth: sz + 8, padding: 0, border: "none", background: "transparent", cursor: "pointer" }}
                >
                  {cell}
                </button>
              ) : (
                cell
              )}
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 8.5,
                  color: isCurrent || isSelected ? p.currentFg : p.dim,
                  fontWeight: isCurrent || isSelected ? 500 : 400,
                }}
              >
                {w.label}
              </span>
            </div>
          );
        })}
      </div>
      {editorPanel}
    </div>
  );
}

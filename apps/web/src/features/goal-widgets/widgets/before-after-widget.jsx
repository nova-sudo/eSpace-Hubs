"use client";

import { useEffect, useState } from "react";
import { WidgetShell } from "../widget-shell";
import { useGoalInputs } from "@/features/goal-inputs";

/**
 * Before / after snapshot. Two numbers: baseline (set once) and current
 * (updated over time). Displays the delta + arrow direction.
 *
 * Data model: latest entry is { baseline, current } (either may be null
 * until both are set).
 */
export function BeforeAfterWidget({ spec, goal, variant = "light", className, onRetry }) {
  const { latest, append } = useGoalInputs(goal?.id);
  const stored = latest?.value || {};
  const [baseline, setBaseline] = useState("");
  const [current, setCurrent] = useState("");

  // Hydrate local inputs from the latest stored entry.
  useEffect(() => {
    setBaseline(
      stored.baseline != null && stored.baseline !== "" ? String(stored.baseline) : "",
    );
    setCurrent(
      stored.current != null && stored.current !== "" ? String(stored.current) : "",
    );
  }, [stored.baseline, stored.current]);

  const delta =
    isFiniteNumber(stored.current) && isFiniteNumber(stored.baseline)
      ? stored.current - stored.baseline
      : null;
  const target = spec.manual?.target;
  const goodDirection = !target || target.op === ">=" ? delta > 0 : delta < 0;

  function save() {
    const b = Number(baseline);
    const c = Number(current);
    if (!Number.isFinite(b) && !Number.isFinite(c)) return;
    append({
      baseline: Number.isFinite(b) ? b : stored.baseline ?? null,
      current: Number.isFinite(c) ? c : stored.current ?? null,
    });
  }

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label="Before → After"
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col justify-between gap-3">
        <div className="flex items-end gap-3">
          <Tile
            label="Baseline"
            value={stored.baseline}
            unit={spec.manual?.unit}
            variant={variant}
          />
          <Arrow variant={variant} />
          <Tile
            label="Current"
            value={stored.current}
            unit={spec.manual?.unit}
            emphasis
            variant={variant}
          />
          {delta != null ? (
            <div
              className="uppercase tracking-[0.5px]"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color:
                  delta === 0
                    ? variant === "light"
                      ? "rgba(255,255,255,0.6)"
                      : "var(--muted-fg)"
                    : goodDirection
                      ? "var(--accent-2)"
                      : "rgba(255,255,255,0.7)",
              }}
            >
              Δ {delta > 0 ? "+" : ""}{Math.round(delta * 100) / 100}
            </div>
          ) : null}
        </div>

        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: variant === "light" ? "rgba(255,255,255,0.68)" : "var(--muted-fg)",
          }}
        >
          {spec.manual?.prompt || "Compare starting point to now"}
        </div>

        {/* Two number inputs + Save button. `min-w-0` on the row + each
            input shrinks below the input's intrinsic width on narrow tiles
            (the spinner-arrow chrome is non-zero). */}
        <div className="flex min-w-0 items-center gap-1.5">
          <NumberField
            label="baseline"
            value={baseline}
            onChange={setBaseline}
            variant={variant}
          />
          <NumberField
            label="current"
            value={current}
            onChange={setCurrent}
            variant={variant}
          />
          <button
            type="button"
            onClick={save}
            className="shrink-0 rounded-[var(--radius-sub)] px-3 py-1.5 font-bold uppercase"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              letterSpacing: "0.4px",
              background: variant === "light" ? "#ffffff" : "var(--accent)",
              color:
                variant === "light" ? "var(--accent)" : "var(--accent-on)",
            }}
          >
            Save
          </button>
        </div>
      </div>
    </WidgetShell>
  );
}

function Tile({ label, value, unit, emphasis, variant }) {
  return (
    <div className="flex flex-col">
      <span
        className="uppercase tracking-[0.5px]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          color: variant === "light" ? "rgba(255,255,255,0.6)" : "var(--muted-fg)",
        }}
      >
        {label}
      </span>
      <span
        className="font-semibold leading-none"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: emphasis ? 36 : 28,
          letterSpacing: "-1px",
          opacity: value == null || value === "" ? 0.5 : 1,
        }}
      >
        {value == null || value === "" ? "—" : value}
      </span>
      {unit ? (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: variant === "light" ? "rgba(255,255,255,0.6)" : "var(--muted-fg)",
          }}
        >
          {unit}
        </span>
      ) : null}
    </div>
  );
}

function Arrow({ variant }) {
  return (
    <span
      style={{
        color: variant === "light" ? "rgba(255,255,255,0.4)" : "var(--dim-fg)",
        fontFamily: "var(--font-mono)",
        fontSize: 18,
        padding: "0 2px",
      }}
    >
      →
    </span>
  );
}

function NumberField({ label, value, onChange, variant }) {
  return (
    <input
      type="number"
      placeholder={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-w-0 flex-1 rounded-[var(--radius-sub)] bg-transparent px-2 py-1.5 outline-none"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: variant === "light" ? "#ffffff" : "var(--fg)",
        border:
          variant === "light"
            ? "1px solid rgba(255,255,255,0.22)"
            : "1px solid var(--border)",
      }}
    />
  );
}

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

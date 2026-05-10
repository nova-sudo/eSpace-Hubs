"use client";

import { useMemo } from "react";
import { WidgetShell } from "../widget-shell";
import {
  cadenceWindowLabel,
  computeCompliance,
  useGoalInputs,
} from "@/features/goal-inputs";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const WEEKS = 8;

/**
 * Manual "counter" widget — cadence-aware compliance display.
 *
 * Each click appends a timestamped entry to the goal-inputs store. The
 * widget headline now shows COMPLIANCE — the % of cadence windows that
 * met the target — instead of a lifetime sum that would lie about
 * weekly goals (e.g. "log 3h/week" reading "on target" forever after a
 * single 3-hour log).
 *
 * Compliance is computed with PARTIAL CREDIT for windows that came
 * close but missed: a week where the user logged 2/3 hours contributes
 * 0.67 instead of 0. So 9 perfect weeks + 1 week of 2 hours over a
 * 10-week tracking period = (9 + 0.67)/10 = 96.7%, which matches the
 * "I missed by a little, not by a lot" intuition.
 *
 * When there's no target on the spec, or the cadence isn't bucketable
 * (per-incident, milestone, continuous), we fall back to the lifetime
 * total — that surface still exists as a sub-line for context.
 */
export function CounterWidget({ spec, goal, variant = "light", className, onRetry }) {
  const { entries, append } = useGoalInputs(goal?.id);

  const total = useMemo(
    () =>
      entries.reduce((sum, e) => {
        const n = Number(e.value);
        return Number.isFinite(n) ? sum + n : sum;
      }, 0),
    [entries],
  );

  const cadence = spec.manual?.cadence || "weekly";
  const target = spec.manual?.target;
  const compliance = useMemo(
    () => computeCompliance(entries, target, cadence),
    [entries, target, cadence],
  );

  const weekly = useMemo(() => weeklyTotals(entries, WEEKS), [entries]);
  const maxW = Math.max(...weekly, 1);
  const promptCopy = spec.manual?.prompt || "Log a count";
  const unit = spec.manual?.unit || "";

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={`Counter · ${cadence}`}
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col justify-between gap-3">
        <Headline
          compliance={compliance}
          total={total}
          unit={unit}
          target={target}
          cadence={cadence}
          variant={variant}
        />
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: variant === "light" ? "rgba(255,255,255,0.68)" : "var(--muted-fg)",
          }}
        >
          {promptCopy}
        </div>
        <WeeklyBars data={weekly} max={maxW} variant={variant} />
        <div className="flex items-center gap-1.5">
          <StepButton variant={variant} onClick={() => append(-1)}>
            −1
          </StepButton>
          <StepButton variant={variant} onClick={() => append(1)}>
            +1
          </StepButton>
          <StepButton variant={variant} onClick={() => append(5)}>
            +5
          </StepButton>
        </div>
      </div>
    </WidgetShell>
  );
}

/**
 * Headline — two modes:
 *
 *   1. compliance computed  →  big "X%" headline + sub:
 *      "M of N <cadence>s on target · Σ Y <unit> logged"
 *   2. no target / unsupported cadence  →  fall back to lifetime total
 *      (the legacy display)
 */
function Headline({ compliance, total, unit, target, cadence, variant }) {
  const muted =
    variant === "light" ? "rgba(255,255,255,0.72)" : "var(--muted-fg)";
  const monoStyle = {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: muted,
    lineHeight: 1.4,
  };

  if (compliance) {
    const [singular, plural] = cadenceWindowLabel(compliance.cadence);
    const noun = compliance.totalWindows === 1 ? singular : plural;
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <div
            className="font-semibold leading-none"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 48,
              letterSpacing: "-1.6px",
            }}
          >
            {compliance.pct}%
          </div>
          <div style={monoStyle}>
            on target
            {compliance.partial ? " · partial cadence" : ""}
          </div>
        </div>
        <div style={monoStyle}>
          {compliance.metWindows} of {compliance.totalWindows} {noun} at
          target {compliance.targetOp} {compliance.targetValue}
          {unit ? ` ${unit}` : ""}
          {" · Σ "}
          {total} {unit || "logged"}
        </div>
      </div>
    );
  }

  // Legacy fallback — no target or non-bucketable cadence (per-incident /
  // milestone / continuous). Lifetime sum is the right read here.
  return (
    <div className="flex items-baseline gap-2">
      <div
        className="font-semibold leading-none"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 48,
          letterSpacing: "-1.6px",
        }}
      >
        {total}
      </div>
      <div style={monoStyle}>
        {unit || "total"}
        {target ? ` · target ${target.op} ${target.value}` : ""}
        {cadence ? ` · ${cadence}` : ""}
      </div>
    </div>
  );
}

function weeklyTotals(entries, weeks) {
  const out = new Array(weeks).fill(0);
  const now = Date.now();
  for (const e of entries) {
    const idx = weeks - 1 - Math.floor((now - e.ts) / WEEK_MS);
    if (idx >= 0 && idx < weeks) {
      const n = Number(e.value);
      if (Number.isFinite(n)) out[idx] += n;
    }
  }
  return out;
}

function WeeklyBars({ data, max, variant }) {
  const lastIdx = data.length - 1;
  return (
    <div className="flex items-end gap-[3px]" style={{ height: 28 }}>
      {data.map((v, i) => {
        const h = Math.max(2, (Math.abs(v) / max) * 26);
        const isLast = i === lastIdx;
        return (
          <span
            key={i}
            className="flex-1 rounded-t-[2px]"
            style={{
              height: h,
              background: isLast
                ? variant === "light"
                  ? "#ffffff"
                  : "var(--accent)"
                : variant === "light"
                  ? "rgba(255,255,255,0.35)"
                  : "var(--accent-dim)",
            }}
          />
        );
      })}
    </div>
  );
}

function StepButton({ children, onClick, variant }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[var(--radius-sub)] px-3 py-1.5 font-bold uppercase transition-colors hover:opacity-90"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        letterSpacing: "0.4px",
        border:
          variant === "light"
            ? "1px solid rgba(255,255,255,0.25)"
            : "1px solid var(--border)",
        background:
          variant === "light"
            ? "rgba(255,255,255,0.14)"
            : "var(--card-alt)",
        color: variant === "light" ? "#ffffff" : "var(--fg)",
      }}
    >
      {children}
    </button>
  );
}

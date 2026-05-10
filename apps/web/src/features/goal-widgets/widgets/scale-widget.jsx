"use client";

import { LineSpark } from "@/components/ui";
import { useGoalInputs } from "@/features/goal-inputs";
import { WidgetShell } from "../widget-shell";

/**
 * 1–5 scale ("how confident are you this week?"). Displays latest value,
 * an 8-entry trend, and inline click-to-log buttons.
 */
export function ScaleWidget({ spec, goal, variant = "light", className, onRetry }) {
  const { entries, latest, append } = useGoalInputs(goal?.id);
  const trend = entries.slice(-8).map((e) => {
    const n = Number(e.value);
    return Number.isFinite(n) ? n : 0;
  });
  const currentValue = latest ? Number(latest.value) : null;
  const promptCopy = spec.manual?.prompt || "Rate yourself 1–5";

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={`Scale · ${spec.manual?.cadence || "weekly"}`}
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <div
            className="font-semibold leading-none"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 48,
              letterSpacing: "-1.6px",
            }}
          >
            {currentValue ?? "—"}
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: variant === "light" ? "rgba(255,255,255,0.72)" : "var(--muted-fg)",
            }}
          >
            /5
          </div>
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: variant === "light" ? "rgba(255,255,255,0.68)" : "var(--muted-fg)",
          }}
        >
          {promptCopy}
        </div>
        {trend.length >= 2 ? (
          <LineSpark
            data={trend}
            color={variant === "light" ? "#ffffff" : "var(--accent)"}
            height={36}
            strokeWidth={2}
            fillOpacity={0.22}
            showDots
          />
        ) : null}
        <div className="flex items-center gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <ScaleButton
              key={n}
              n={n}
              active={currentValue === n}
              variant={variant}
              onClick={() => append(n)}
            />
          ))}
        </div>
      </div>
    </WidgetShell>
  );
}

function ScaleButton({ n, active, onClick, variant }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-8 flex-1 rounded-[var(--radius-sub)] font-bold transition-colors"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        border: active
          ? "1px solid #ffffff"
          : variant === "light"
            ? "1px solid rgba(255,255,255,0.22)"
            : "1px solid var(--border)",
        background: active
          ? variant === "light"
            ? "rgba(255,255,255,0.22)"
            : "var(--accent-dim)"
          : variant === "light"
            ? "rgba(255,255,255,0.08)"
            : "var(--card-alt)",
        color: active
          ? variant === "light"
            ? "#ffffff"
            : "var(--accent)"
          : variant === "light"
            ? "rgba(255,255,255,0.85)"
            : "var(--fg)",
      }}
    >
      {n}
    </button>
  );
}

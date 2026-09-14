"use client";

import { LineSpark, Label } from "@/components/ui";
import { cn } from "@/lib/cn";
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
          <div className="text-[30px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg sm:text-[36px]">
            {currentValue ?? "—"}
          </div>
          <span className="text-[13px] text-muted-fg">/5</span>
        </div>
        <Label>{promptCopy}</Label>
        {trend.length >= 2 ? (
          <LineSpark data={trend} color="var(--ink)" height={36} strokeWidth={2} fillOpacity={0.16} showDots />
        ) : null}
        <div className="flex items-center gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <ScaleButton key={n} n={n} active={currentValue === n} onClick={() => append(n)} />
          ))}
        </div>
      </div>
    </WidgetShell>
  );
}

function ScaleButton({ n, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-9 flex-1 rounded-[var(--radius-md)] text-[13px] font-bold transition-colors",
        active ? "bg-ink text-ink-on" : "bg-card-alt text-fg hover:opacity-80",
      )}
    >
      {n}
    </button>
  );
}

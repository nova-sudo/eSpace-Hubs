"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Badge, Button, Input, Label } from "@/components/ui";
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
      label="Before / after"
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col justify-between gap-3">
        <div className="flex items-end gap-3">
          <Tile label="Baseline" value={stored.baseline} unit={spec.manual?.unit} />
          <ArrowRight size={18} className="mb-1 shrink-0 text-dim-fg" aria-hidden="true" />
          <Tile label="Current" value={stored.current} unit={spec.manual?.unit} emphasis />
          {delta != null ? (
            <Badge tone={delta === 0 ? "neutral" : goodDirection ? "mint" : "peach"}>
              {delta > 0 ? "+" : ""}
              {Math.round(delta * 100) / 100}
            </Badge>
          ) : null}
        </div>

        <Label>{spec.manual?.prompt || "Compare starting point to now"}</Label>

        {/* Two number inputs + Save button. `min-w-0` on the row + each
            input shrinks below the input's intrinsic width on narrow tiles
            (the spinner-arrow chrome is non-zero). */}
        <div className="flex min-w-0 items-center gap-1.5">
          <Input
            type="number"
            placeholder="baseline"
            value={baseline}
            onChange={(e) => setBaseline(e.target.value)}
            className="min-w-0 flex-1"
          />
          <Input
            type="number"
            placeholder="current"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="min-w-0 flex-1"
          />
          <Button size="sm" className="shrink-0" onClick={save}>
            Save
          </Button>
        </div>
      </div>
    </WidgetShell>
  );
}

function Tile({ label, value, unit, emphasis }) {
  return (
    <div className="flex flex-col">
      <Label>{label}</Label>
      <span
        className={
          emphasis
            ? "text-[36px] font-extrabold leading-none tracking-[-0.03em] tabular-nums text-fg"
            : "text-[28px] font-extrabold leading-none tracking-[-0.03em] tabular-nums text-fg"
        }
        style={{ opacity: value == null || value === "" ? 0.4 : 1 }}
      >
        {value == null || value === "" ? "—" : value}
      </span>
      {unit ? <span className="text-[12.5px] text-muted-fg">{unit}</span> : null}
    </div>
  );
}

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

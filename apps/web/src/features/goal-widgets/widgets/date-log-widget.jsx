"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button, IconButton, Input, Label } from "@/components/ui";
import { WidgetShell } from "../widget-shell";
import { useGoalInputs } from "@/features/goal-inputs";
import { fullDate } from "@/lib/date";

/**
 * "Date log" — pin a date (past or future) against an optional note.
 * Example goals: "Publish 2 tech-talks this year". Each talk is a date-entry.
 */
export function DateLogWidget({ spec, goal, variant = "light", className, onRetry }) {
  const { entries, append, remove } = useGoalInputs(goal?.id);
  const [date, setDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [note, setNote] = useState("");

  function logEntry() {
    if (!date) return;
    const t = new Date(date);
    if (Number.isNaN(t.getTime())) return;
    append(t.toISOString(), note || undefined);
    setNote("");
  }

  const target = spec.manual?.target;
  const reachedTarget =
    target && target.op === ">=" ? entries.length >= target.value : null;

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={`Date log · ${entries.length} entries`}
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <div className="text-[30px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg sm:text-[36px]">
            {entries.length}
          </div>
          <span className="text-[13px] text-muted-fg">
            {spec.manual?.unit || "events"}
            {target ? ` · target ${target.op} ${target.value}` : ""}
            {reachedTarget ? " · reached" : ""}
          </span>
        </div>
        <Label>{spec.manual?.prompt || "Log dated events"}</Label>
        {/* Input row.
            Native <input type="date"> has a chunky intrinsic width
            (~150px in Chrome) and the <input> "note" wants to grow.
            Without `min-w-0` on this flex row AND `min-w-0` on each
            shrinkable child, the row pushes wider than the card and the
            tile clips. The button stays `shrink-0` so it always shows. */}
        <div className="flex min-w-0 items-center gap-1.5">
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="min-w-0 flex-1"
          />
          <Input
            placeholder="note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="min-w-0 flex-1"
          />
          <Button size="sm" className="shrink-0" onClick={logEntry}>
            Log
          </Button>
        </div>
        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1 text-[13px]">
          {entries.slice().reverse().map((e) => (
            <li
              key={e.ts}
              className="group flex items-center gap-2 rounded-[var(--radius-md)] bg-card-alt px-2 py-1.5"
            >
              <span className="shrink-0 font-bold text-fg">{fullDate(e.value)}</span>
              <span className="flex-1 truncate text-muted-fg">{e.note || "—"}</span>
              <IconButton
                label="Remove"
                size="sm"
                onCard
                className="opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => remove(e.ts)}
              >
                <X size={14} />
              </IconButton>
            </li>
          ))}
        </ul>
      </div>
    </WidgetShell>
  );
}

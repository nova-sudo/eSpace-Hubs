"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button, IconButton, Label } from "@/components/ui";
import { cn } from "@/lib/cn";
import { WidgetShell } from "../widget-shell";
import { useGoalInputs } from "@/features/goal-inputs";
import { fullDate } from "@/lib/date";

/**
 * Free-text journal. Each entry is a dated note the user writes. Useful
 * for goals that are narrative in nature (e.g. "write 1 insight per week").
 */
export function FreeTextWidget({ spec, goal, variant = "light", className, onRetry }) {
  const { entries, append, remove } = useGoalInputs(goal?.id);
  const [draft, setDraft] = useState("");

  function submit() {
    const body = draft.trim();
    if (!body) return;
    append(body);
    setDraft("");
  }

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={`Journal · ${entries.length} entries`}
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col gap-2">
        <Label>{spec.manual?.prompt || "Capture a short note"}</Label>
        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1 text-[13px]">
          {entries.length === 0 ? <li className="text-dim-fg">No entries yet.</li> : null}
          {entries.slice().reverse().map((e) => (
            <li key={e.ts} className="group flex flex-col gap-0.5 rounded-[var(--radius-md)] bg-card-alt px-2.5 py-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] text-muted-fg">{fullDate(new Date(e.ts).toISOString())}</span>
                <IconButton
                  label="Remove"
                  size="sm"
                  onCard
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => remove(e.ts)}
                >
                  <X size={12} />
                </IconButton>
              </div>
              <div className="whitespace-pre-wrap break-words text-fg">{String(e.value)}</div>
            </li>
          ))}
        </ul>
        <div className="flex items-end gap-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a short note…"
            rows={1}
            className={cn(
              "max-h-[100px] min-h-[44px] flex-1 resize-none rounded-[var(--radius-lg)] bg-card-alt px-3.5 py-2.5 text-[14px] text-fg outline-none placeholder:text-dim-fg focus:ring-2 focus:ring-ink",
            )}
          />
          <Button size="sm" disabled={!draft.trim()} onClick={submit}>
            Log
          </Button>
        </div>
      </div>
    </WidgetShell>
  );
}

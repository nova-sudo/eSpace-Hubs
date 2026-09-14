"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button, Checkbox, IconButton, Input, ItemEvidence, Label } from "@/components/ui";
import { WidgetShell } from "../widget-shell";
import { useGoalInputs } from "@/features/goal-inputs";
import { useGoalContext, resolveMilestoneItems } from "@/features/goal-context";

/**
 * Milestone checklist.
 *
 * Three sources, in priority:
 *   1. The user's edits — `goal-inputs` latest entry's `items` array.
 *   2. The user's context answers — every `kind: "list"` answer the user
 *      gave to the AI's `context.questions` block flows in as milestones,
 *      flattened in question order. This is the "I just defined what done
 *      looks like, those should be my milestones" path.
 *   3. The AI-pre-seeded items in `spec.manual.items` — older specs that
 *      didn't go through context collection.
 *
 * Once the user toggles or adds, an entry is written; from then on, the
 * entries list owns the source of truth. If the user later wipes every
 * milestone (entries.items.length === 0), we fall back to the context
 * seed again — that way "edit truths" → "wipe list" → "save" is a clean
 * way to re-seed from the latest truths.
 */
export function MilestoneWidget({ spec, goal, variant = "light", className, onRetry }) {
  const { entries, latest, append } = useGoalInputs(goal?.id);
  const { answers: contextAnswers } = useGoalContext(goal?.id);
  // One-time milestone: an emptied list re-seeds from the latest truths.
  const items = useMemo(
    () =>
      resolveMilestoneItems(latest?.value?.items, spec, contextAnswers, {
        reseedOnEmpty: true,
      }),
    [latest, spec, contextAnswers],
  );
  const done = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  const [draft, setDraft] = useState("");
  const promptCopy = spec.manual?.prompt || "Check off milestones";

  function toggle(id) {
    const next = items.map((it) =>
      it.id === id ? { ...it, done: !it.done } : it,
    );
    append({ items: next });
  }

  function add() {
    const label = draft.trim();
    if (!label) return;
    const next = [
      ...items,
      { id: `m-${Date.now()}`, label, done: false },
    ];
    append({ items: next });
    setDraft("");
  }

  function remove(id) {
    const next = items.filter((i) => i.id !== id);
    append({ items: next });
  }

  function setEvidence(id, text) {
    const next = items.map((it) =>
      it.id === id ? { ...it, evidence: text || undefined } : it,
    );
    append({ items: next });
  }

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={`Milestones · ${done}/${total}`}
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <div className="text-[30px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg sm:text-[36px]">
            {pct}%
          </div>
          <span className="text-[13px] text-muted-fg">complete</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-card-alt">
          <div className="h-full bg-ink" style={{ width: `${pct}%` }} />
        </div>
        <Label>{promptCopy}</Label>
        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto text-[13px]">
          {items.length === 0 ? <li className="text-dim-fg">No milestones yet.</li> : null}
          {items.map((it) => (
            <li key={it.id} className="group flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <Checkbox checked={!!it.done} onChange={() => toggle(it.id)} label={it.label || it.title || "milestone item"} />
                <span
                  className={it.done ? "flex-1 truncate text-dim-fg line-through" : "flex-1 truncate text-fg"}
                  title={it.label}
                >
                  {it.label}
                </span>
                <IconButton
                  label={`Remove ${it.label}`}
                  size="sm"
                  onCard
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => remove(it.id)}
                >
                  <X size={12} />
                </IconButton>
              </div>
              <div className="min-w-0 pl-[26px]">
                <ItemEvidence value={it.evidence} variant="dark" onSave={(t) => setEvidence(it.id, t)} />
              </div>
            </li>
          ))}
        </ul>
        {/* Input row — `min-w-0` on parent + child so the text input shrinks
            below its intrinsic width on narrow tiles. Button stays `shrink-0`. */}
        <div className="flex min-w-0 items-center gap-1.5">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="+ Add milestone"
            className="min-w-0 flex-1"
          />
          <Button size="sm" disabled={!draft.trim()} className="shrink-0" onClick={add}>
            Add
          </Button>
        </div>
        {/* Footnote count */}
        <Label>
          {entries.length} revision{entries.length === 1 ? "" : "s"}
        </Label>
      </div>
    </WidgetShell>
  );
}

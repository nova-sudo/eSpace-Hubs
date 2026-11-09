"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button, Checkbox, Label, Badge } from "@/components/ui";

/**
 * Choose which goals the analyst runs on. Every L2 the user owns is listed
 * (grouped under its L1) with a checkbox and its current state, so a run
 * can target exactly the goals the user picks — first-time classification,
 * a re-analysis of a few trackers, or both at once. A re-analysis never
 * replaces a tracker until its proposal is saved from Review.
 *
 * Unclassified rows keep the "Build my own" shortcut, which skips the
 * classifier for that goal entirely.
 *
 * Selection defaults to the unclassified goals — the common "analyze the
 * rest" case is one click — and drops ids whose goal disappears.
 */
export function GoalPicker({ goals, classifiedIds, invalidIds, disabled, onAnalyze, onBuildOwn }) {
  const [selected, setSelected] = useState(
    () => new Set(goals.filter((g) => !classifiedIds.has(g.id)).map((g) => g.id)),
  );

  const goalIdsKey = goals.map((g) => g.id).join("|");
  useEffect(() => {
    const live = new Set(goalIdsKey.split("|"));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [goalIdsKey]);

  const groups = useMemo(() => {
    const out = [];
    for (const g of goals) {
      const last = out[out.length - 1];
      if (last && last.title === g.parentL1Title) last.goals.push(g);
      else out.push({ title: g.parentL1Title, goals: [g] });
    }
    return out;
  }, [goals]);

  if (goals.length === 0) return null;

  const allSelected = selected.size === goals.length;
  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(goals.map((g) => g.id)));

  return (
    <div className="flex flex-col rounded-[var(--radius-lg)] bg-card-alt">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Checkbox
            checked={allSelected}
            onChange={toggleAll}
            label={allSelected ? "Deselect all goals" : "Select all goals"}
          />
          <Label>
            Choose goals to analyze · {selected.size}/{goals.length}
          </Label>
        </div>
        <Button
          variant="ink"
          size="sm"
          disabled={disabled || selected.size === 0}
          onClick={() => onAnalyze([...selected])}
        >
          Analyze selected{selected.size > 0 ? ` (${selected.size})` : ""}
        </Button>
      </div>
      <div className="flex max-h-[320px] flex-col overflow-y-auto">
        {groups.map((group, gi) => (
          <div key={`${group.title}-${gi}`} className="flex flex-col">
            {group.title ? (
              <div
                className="truncate border-t border-line px-4 pb-1 pt-3 text-[12px] text-muted-fg first:border-t-0"
                title={group.title}
              >
                {group.title}
              </div>
            ) : null}
            {group.goals.map((g) => {
              const classified = classifiedIds.has(g.id);
              const invalid = invalidIds?.has(g.id);
              return (
                <div key={g.id} className="flex min-w-0 items-center justify-between gap-3 px-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Checkbox
                      checked={selected.has(g.id)}
                      onChange={() => toggle(g.id)}
                      label={g.title || "(untitled)"}
                    />
                    <span className="truncate text-[13.5px] text-fg" title={g.title}>
                      {g.title || "(untitled)"}
                    </span>
                    {invalid ? (
                      <Badge tone="peach">Needs re-analysis</Badge>
                    ) : classified ? (
                      <Badge tone="mint">Tracked</Badge>
                    ) : (
                      <Badge tone="lemon">Not classified</Badge>
                    )}
                  </div>
                  {!classified && onBuildOwn ? (
                    <button
                      type="button"
                      onClick={() => onBuildOwn(g)}
                      className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-bold text-fg"
                      title="Already know how you want to track this? Skip the classifier and describe your own tracker."
                    >
                      Build my own <ArrowRight size={13} />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

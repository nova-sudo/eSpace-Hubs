"use client";

/**
 * A list of shared goals as rows: title, schedule, headline rates and the
 * currently open period. Clicking a row selects it (the parent decides
 * whether that opens an inline view or navigates).
 */

import { ChevronRight } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fmtDay, pct } from "./progress-grid";

export function SharedGoalsList({ goals, selectedId, onSelect, empty }) {
  if (goals.length === 0) {
    return <Card>{empty}</Card>;
  }
  return (
    <Card padding={8}>
      <ul className="flex flex-col">
        {goals.map((g) => {
          const active = g.id === selectedId;
          return (
            <li key={g.id} className="border-t border-line first:border-t-0">
              <button
                type="button"
                onClick={() => onSelect?.(g)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-3 rounded-[var(--radius-lg)] px-3.5 py-3 text-left",
                  active ? "bg-card-alt" : "hover:bg-card-alt",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[14.5px] font-bold text-fg">{g.title}</span>
                    {g.status === "archived" ? <Badge>Archived</Badge> : null}
                  </div>
                  <div className="mt-0.5 truncate text-[12.5px] text-muted-fg">
                    {g.assigneeCount} {g.assigneeCount === 1 ? "assignee" : "assignees"} ·{" "}
                    {g.windowCount} {g.windowCount === 1 ? "period" : "periods"}
                    {g.code ? <> · <span className="font-mono">{g.code}</span></> : null}
                  </div>
                </div>
                <div className="hidden shrink-0 text-right sm:block">
                  <div className="text-[14px] font-bold tabular-nums">{pct(g.totals?.onTimeRate)}</div>
                  <div className="text-[12px] text-muted-fg">on time</div>
                </div>
                {g.totals?.missing ? (
                  <Badge tone="peach" dot>{g.totals.missing} missing</Badge>
                ) : g.currentWindow ? (
                  <Badge tone="lemon" dot>
                    {g.currentWindow.label} due {fmtDay(g.currentWindow.deadline)}
                  </Badge>
                ) : null}
                <ChevronRight size={16} className="shrink-0 text-muted-fg" />
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

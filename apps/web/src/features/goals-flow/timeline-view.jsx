"use client";

/**
 * Timeline — one row per goal across a 12-month axis.
 *
 * The axis is the CYCLE (the calendar year this product grades on), and each
 * cell is the state of whatever cadence windows fall inside that month, taken
 * straight from `cadenceWindowsFor` — a weekly goal packs four or five
 * windows into a cell, a quarterly one spans three. The cell reports the
 * worst of them, because that is the one that needs you: owed beats current
 * beats filled. The same grey pacing tick the summary row draws is laid over
 * every axis, so "behind" is something you see rather than read.
 */

import { ChevronDown } from "lucide-react";
import { Badge, Card, Label, yearElapsedPercent } from "@/components/ui";
import { GoalTierBadge } from "@/features/goal-tiers";
import { cn } from "@/lib/cn";
import { humanizeKind } from "./flow-row-meta";

const MONTH_INITIALS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

const CELL_STYLE = {
  filled: { background: "var(--ink)" },
  owed: { background: "transparent", border: "1.5px solid var(--peach-ink)" },
  current: { background: "var(--card-alt)", border: "1.5px dashed var(--dim-fg)" },
  settled: { background: "var(--card-alt)", opacity: 0.6 },
  future: { background: "var(--card-alt)" },
  none: { background: "var(--card-alt)", opacity: 0.45 },
};

/** Worst-first, so a month holding one owed window reads as owed. */
const CELL_PRIORITY = ["owed", "current", "filled", "settled"];

/** The 12 month cells for one goal, or null when it has no cadence at all. */
function monthCells(cyc, year) {
  if (!cyc) return null;
  const windows = cyc.windows || [];
  if (windows.length === 0) return null;
  return Array.from({ length: 12 }, (_, m) => {
    const start = Date.UTC(year, m, 1);
    const end = Date.UTC(year, m + 1, 1);
    const hits = windows.filter((w) => w.start < end && w.end > start);
    if (hits.length === 0) return "none";
    for (const state of CELL_PRIORITY) {
      if (hits.some((w) => w.state === state)) return state;
    }
    return "future";
  });
}

export function TimelineView({
  rows,
  selectedId,
  onSelect,
  collapsedIds,
  onToggleGroup,
  focusedId,
  registerRow,
  density = "comfortable",
}) {
  const compact = density === "dense";
  const now = new Date();
  const year = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();
  const expected = yearElapsedPercent();

  return (
    <Card padding={20} className="flex flex-col">
      <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-3 border-b border-line pb-2.5 sm:grid-cols-[minmax(130px,230px)_minmax(0,1fr)_96px]">
        <Label caps>Goal · {year}</Label>
        <div className="hidden grid-cols-12 gap-[3px] sm:grid">
          {MONTH_INITIALS.map((m, i) => (
            <span
              key={`${m}-${i}`}
              className={cn(
                "text-center text-[11px]",
                i === currentMonth ? "font-extrabold text-fg" : "font-medium text-dim-fg",
              )}
            >
              {m}
            </span>
          ))}
        </div>
        <Label caps className="hidden text-right sm:block">
          Tier
        </Label>
      </div>

      {rows.map((row) => {
        const collapsed = collapsedIds.has(row.l1.id);
        return (
          <div key={row.l1.id} className="flex flex-col">
            <button
              type="button"
              onClick={() => onToggleGroup(row.l1.id)}
              aria-expanded={!collapsed}
              className="flex items-center gap-2 border-t border-line pb-1.5 pt-3 text-left"
            >
              <Label className="min-w-0 truncate">{row.l1.title || "Untitled objective"}</Label>
              <Badge tone="neutral">{row.l2s.length}</Badge>
              <ChevronDown
                size={13}
                className={cn(
                  "shrink-0 text-dim-fg transition-transform",
                  collapsed ? "-rotate-90" : "",
                )}
              />
            </button>

            {collapsed
              ? null
              : row.l2s.map((it) => {
                  const cells = monthCells(it.status.cyc, year);
                  const title = it.spec?.title || it.goal.title || "(untitled)";
                  return (
                    <button
                      key={it.goal.id}
                      type="button"
                      data-goal-row={it.goal.id}
                      ref={(el) => registerRow(it.goal.id, el)}
                      tabIndex={focusedId === it.goal.id ? 0 : -1}
                      aria-current={it.goal.id === selectedId ? "true" : undefined}
                      onClick={() => onSelect(it.goal.id)}
                      className={cn(
                        "grid grid-cols-[minmax(0,1fr)] items-center gap-3 border-t border-line text-left sm:grid-cols-[minmax(130px,230px)_minmax(0,1fr)_96px]",
                        compact ? "py-2" : "py-3",
                      )}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[13px] font-bold text-fg" title={title}>
                          {title}
                        </span>
                        <span className="truncate text-[11px] text-muted-fg">
                          {it.spec ? humanizeKind(it.spec.widget) : "Unclassified"}
                          {it.status.cyc ? ` · ${it.status.cyc.filledCount}/${it.status.cyc.total}` : ""}
                        </span>
                      </span>

                      <span className="relative grid grid-cols-12 gap-[3px]">
                        {Array.from({ length: 12 }, (_, i) => {
                          const state = cells ? cells[i] : "none";
                          return (
                            <span
                              key={i}
                              className="rounded-[var(--radius-md)]"
                              style={{
                                height: compact ? 12 : 15,
                                boxSizing: "border-box",
                                ...(CELL_STYLE[state] || CELL_STYLE.none),
                              }}
                            />
                          );
                        })}
                        <span
                          aria-hidden="true"
                          title={`Expected by now: ${Math.round(expected)}%`}
                          style={{
                            position: "absolute",
                            top: -3,
                            bottom: -3,
                            left: `${expected}%`,
                            width: 2,
                            borderRadius: 2,
                            background: "var(--dim-fg)",
                          }}
                        />
                      </span>

                      <span className="flex justify-start sm:justify-end">
                        {it.spec ? (
                          <GoalTierBadge goalId={it.goal.id} spec={it.spec} />
                        ) : (
                          <Badge tone="neutral">Unclassified</Badge>
                        )}
                      </span>
                    </button>
                  );
                })}
          </div>
        );
      })}
    </Card>
  );
}

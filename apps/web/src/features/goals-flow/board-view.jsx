"use client";

/**
 * Board — the same goals sorted into four status columns.
 *
 * The column is not a new piece of state a user has to maintain: it is
 * `goalStatusFor`, which is itself the cadence windows plus the capped tier
 * verdict. Nothing is draggable for that reason — you move a card by logging
 * a window, not by dragging it.
 *
 * An unclassified goal has nothing logged and no tracker to log into, so it
 * sits in "Not logged" marked as such rather than dropping out of the board
 * entirely; opening it lands on the Focus pane, where the classify action is.
 */

import { Badge, Card, PacedBar } from "@/components/ui";
import { cn } from "@/lib/cn";
import { BOARD_COLUMNS, GOAL_STATUS, STATUS_META } from "./goal-status";

function columnOf(status) {
  return status === GOAL_STATUS.UNCLASSIFIED ? GOAL_STATUS.NOT_LOGGED : status;
}

export function BoardView({
  items,
  selectedId,
  onSelect,
  focusedId,
  registerRow,
  density = "comfortable",
}) {
  const compact = density === "dense";
  const byColumn = new Map(BOARD_COLUMNS.map((c) => [c, []]));
  for (const it of items) {
    const col = columnOf(it.status.status);
    if (byColumn.has(col)) byColumn.get(col).push(it);
  }

  return (
    <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {BOARD_COLUMNS.map((col) => {
        const list = byColumn.get(col) || [];
        return (
          <div
            key={col}
            className="flex min-h-[200px] flex-col gap-2.5 rounded-[var(--radius-xl)] bg-card-alt p-3"
          >
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="text-[12.5px] font-bold text-fg">{STATUS_META[col].label}</span>
              <span className="text-[11.5px] font-bold tabular-nums text-muted-fg">
                {list.length}
              </span>
            </div>

            {list.length === 0 ? (
              <span className="px-1 py-4 text-center text-[12px] text-dim-fg">Empty</span>
            ) : (
              list.map((it) => {
                const title = it.spec?.title || it.goal.title || "(untitled)";
                const unclassified = !it.spec;
                return (
                  <button
                    key={it.goal.id}
                    type="button"
                    data-goal-row={it.goal.id}
                    ref={(el) => registerRow(it.goal.id, el)}
                    tabIndex={focusedId === it.goal.id ? 0 : -1}
                    aria-current={it.goal.id === selectedId ? "true" : undefined}
                    onClick={() => onSelect(it.goal.id)}
                    className="rounded-[var(--radius-lg)] text-left"
                  >
                    <Card
                      padding={compact ? 11 : 13}
                      radius="lg"
                      className={cn(
                        "flex flex-col gap-1",
                        it.goal.id === selectedId ? "ring-2 ring-ink" : "",
                      )}
                    >
                      <span className="truncate text-[11px] font-semibold text-dim-fg">
                        {it.goal.parentL1Title || "Objective"}
                      </span>
                      <span
                        className="text-[13px] font-bold leading-[1.3] text-fg"
                        style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                        title={title}
                      >
                        {title}
                      </span>
                      <span className="mt-2 block">
                        {it.status.pct != null ? (
                          <PacedBar value={it.status.pct} height={5} />
                        ) : (
                          <span className="text-[11.5px] text-muted-fg">
                            {unclassified ? "No tracker yet" : "No number to pace against"}
                          </span>
                        )}
                      </span>
                      {unclassified ? (
                        <span className="mt-2 flex">
                          <Badge tone="lav">Needs classifying</Badge>
                        </span>
                      ) : null}
                    </Card>
                  </button>
                );
              })
            )}
          </div>
        );
      })}
    </div>
  );
}

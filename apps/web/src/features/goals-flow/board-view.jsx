"use client";

/**
 * Board — the same goals sorted into four status columns.
 *
 * The column is not a new piece of state a user has to maintain: it is
 * `goalStatusFor`, which is itself the cadence windows plus the capped tier
 * verdict. Nothing is draggable for that reason — you move a card by logging
 * a window, not by dragging it.
 *
 * Goals that aren't measured — no tracker yet, still in setup, or
 * auto-tracked — get their own last column, each card wearing its own shared
 * status badge, instead of being filed under "Not logged" (which they
 * aren't) or dropping off the board.
 */

import { Badge, Card, PacedBar } from "@/components/ui";
import { cn } from "@/lib/cn";
import { BOARD_COLUMNS, GOAL_STATUS, STATUS_META } from "./goal-status";

const NOT_MEASURED = "not-measured";
const COLUMNS = [...BOARD_COLUMNS, NOT_MEASURED];

const COLUMN_TITLE = {
  [NOT_MEASURED]: "Not measured yet",
};

const EMPTY_COPY = {
  [GOAL_STATUS.NOT_LOGGED]: "Nothing waiting for a first entry",
  [GOAL_STATUS.BEHIND]: "Nothing behind",
  [GOAL_STATUS.ON_PACE]: "Nothing on pace yet",
  [GOAL_STATUS.EXCEEDING]: "Nothing exceeding yet",
  [NOT_MEASURED]: "Every goal is measured",
};

function columnOf(status) {
  return BOARD_COLUMNS.includes(status) ? status : NOT_MEASURED;
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
  const byColumn = new Map(COLUMNS.map((c) => [c, []]));
  for (const it of items) {
    const col = columnOf(it.status.status);
    if (byColumn.has(col)) byColumn.get(col).push(it);
  }

  return (
    <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {COLUMNS.map((col) => {
        const list = byColumn.get(col) || [];
        return (
          <div
            key={col}
            className="flex min-h-[200px] flex-col gap-2.5 rounded-[var(--radius-xl)] bg-card-alt p-3"
          >
            <div className="flex items-center justify-between gap-2 px-1">
              <h2 className="m-0 text-[12.5px] font-bold text-fg">
                {COLUMN_TITLE[col] ?? STATUS_META[col].label}
              </h2>
              <span className="text-[11.5px] font-bold tabular-nums text-muted-fg">
                {list.length}
              </span>
            </div>

            {list.length === 0 ? (
              <span className="px-1 py-4 text-center text-[12px] text-muted-fg">{EMPTY_COPY[col]}</span>
            ) : (
              list.map((it) => {
                const title = it.goal.title || it.spec?.title || "(untitled)";
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
                      <span className="truncate text-[11px] font-semibold text-muted-fg">
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
                          <PacedBar value={it.status.pct} expected={100} height={5} />
                        ) : (
                          <span className="text-[11.5px] text-muted-fg">
                            {unclassified ? "No tracker yet" : "Nothing due yet"}
                          </span>
                        )}
                      </span>
                      {col === NOT_MEASURED || it.status.reason ? (
                        <span className="mt-2 flex flex-wrap items-center gap-1.5">
                          {col === NOT_MEASURED ? (
                            <Badge tone={it.invalidSpec ? "peach" : it.status.tone}>
                              {it.invalidSpec ? "Tracker data invalid" : it.status.label}
                            </Badge>
                          ) : null}
                          {it.status.reason ? (
                            <span className="text-[11.5px] font-semibold text-fg">{it.status.reason}</span>
                          ) : null}
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

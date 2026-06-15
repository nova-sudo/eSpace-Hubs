"use client";

/**
 * Zone 3 — the Action Queue. The "what should I do next" strip, derived
 * entirely from the health model (useGoalHealth().queue, already severity-
 * sorted: no-data → stale → behind).
 *
 * Each row is a goal that needs filling. For inline-fillable kinds the
 * "Fill" action expands the editor right here (same GoalManualEditor the
 * cards use, scoped to the current work week) so the user never leaves the
 * page; heavier kinds (rubric / scorecard) still link to the check-in.
 * Caps at a handful with a "+N more" so a neglected backlog doesn't turn
 * the hub into a wall of red.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { MonoLabel } from "@/components/ui";
import { GoalManualEditor, isInlineFillable } from "@/features/goal-editors";
import { resolveCompletedWorkWeek } from "@/lib/date";
import { statusDisplay } from "./status";

const MAX_ROWS = 6;

export function ActionQueue({ queue, fillHref }) {
  const [openId, setOpenId] = useState(null);
  // Same most-recent completed work week the cards + check-in write to.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const week = useMemo(() => resolveCompletedWorkWeek(), []);

  if (!queue || queue.length === 0) return null;

  const rows = queue.slice(0, MAX_ROWS);
  const overflow = queue.length - rows.length;

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-card px-5 py-4">
      <div className="flex items-center justify-between">
        <MonoLabel>Do next · {queue.length}</MonoLabel>
        {fillHref ? (
          <Link
            href={fillHref}
            className="text-[10px] uppercase tracking-[0.4px] text-accent hover:underline"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Open check-in →
          </Link>
        ) : null}
      </div>

      <ul className="flex flex-col divide-y divide-border">
        {rows.map((card) => {
          const meta = statusDisplay(card.health);
          const canInline = isInlineFillable(card.spec?.widget) && !!week;
          const isOpen = openId === card.goal.id;
          return (
            <li
              key={card.goal.id}
              className="flex flex-col py-2 first:pt-0.5 last:pb-0.5"
            >
              <div className="flex items-center gap-3">
                <span
                  className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
                  style={{ background: meta?.dot }}
                />
                <span
                  className="min-w-0 flex-1 truncate text-[13px] text-fg"
                  title={card.goal.title}
                >
                  {card.goal.title}
                </span>
                <span
                  className="shrink-0 text-[10px] uppercase tracking-[0.4px] text-muted-fg/70"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {meta?.label}
                </span>
                {canInline ? (
                  <button
                    type="button"
                    onClick={() =>
                      setOpenId((id) => (id === card.goal.id ? null : card.goal.id))
                    }
                    className="shrink-0 text-[11px] font-semibold text-accent hover:underline"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {isOpen ? "Close" : "Fill ▾"}
                  </button>
                ) : fillHref ? (
                  <Link
                    href={fillHref}
                    className="shrink-0 text-[11px] font-semibold text-accent hover:underline"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    Fill →
                  </Link>
                ) : null}
              </div>

              {isOpen && canInline ? (
                <div className="mt-2 pl-[19px]">
                  <GoalManualEditor
                    widget={card.spec.widget}
                    goal={card.goal}
                    spec={card.spec}
                    weekStart={week.start}
                    weekEnd={week.end}
                    activeLabel={week.weekLabel}
                  />
                  <div
                    className="mt-2 text-[9px] uppercase tracking-[0.4px] text-muted-fg/60"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    logging to {week.weekLabel}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {overflow > 0 ? (
        <div
          className="text-[10px] uppercase tracking-[0.4px] text-muted-fg/60"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          +{overflow} more in the grid below
        </div>
      ) : null}
    </div>
  );
}

"use client";

/**
 * Zone 3 — the Action Queue. The "what should I do next" strip, derived
 * entirely from the health model (useGoalHealth().queue, already severity-
 * sorted: no-data → stale → behind).
 *
 * It's deliberately a flat list of one-tap actions, not another dashboard:
 * each row is a goal that needs filling and a single CTA that drops the
 * user straight into the check-in. Caps at a handful with a "+N more" so a
 * neglected backlog doesn't turn the hub into a wall of red.
 */

import Link from "next/link";
import { MonoLabel } from "@/components/ui";
import { STATUS_META } from "./status";

const MAX_ROWS = 6;

export function ActionQueue({ queue, fillHref }) {
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
          const meta = STATUS_META[card.health.status];
          return (
            <li
              key={card.goal.id}
              className="flex items-center gap-3 py-2 first:pt-0.5 last:pb-0.5"
            >
              <span
                className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
                style={{ background: meta?.dot }}
              />
              <span className="min-w-0 flex-1 truncate text-[13px] text-fg" title={card.goal.title}>
                {card.goal.title}
              </span>
              <span
                className="shrink-0 text-[10px] uppercase tracking-[0.4px] text-muted-fg/70"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {meta?.label}
              </span>
              {fillHref ? (
                <Link
                  href={fillHref}
                  className="shrink-0 text-[11px] font-semibold text-accent hover:underline"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  Fill →
                </Link>
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

"use client";

/**
 * The Goal Health Grid — every classified goal as a card, bucketed under
 * its L1 parent heading.
 *
 * Density guard (from the strategy's risk #3): a user with 20+ L2 goals
 * would drown in cards. So the grid DEFAULTS to a "needs attention" focus
 * view — only goals that are unfilled / stale / behind — with a toggle to
 * show everything. The toggle label carries the counts so the user knows
 * what's hidden.
 */

import { useMemo, useState } from "react";
import { MonoLabel } from "@/components/ui";
import { cn } from "@/lib/cn";
import { GoalHealthCard } from "./goal-health-card";
import { NEEDS_ATTENTION } from "./status";

export function GoalHealthGrid({ groups, fillHref }) {
  const [showAll, setShowAll] = useState(false);

  const attentionCount = useMemo(
    () =>
      (groups || []).reduce(
        (sum, g) =>
          sum + g.cards.filter((c) => NEEDS_ATTENTION.has(c.health.status)).length,
        0,
      ),
    [groups],
  );
  const totalCount = useMemo(
    () => (groups || []).reduce((sum, g) => sum + g.cards.length, 0),
    [groups],
  );

  // In focus mode, drop healthy cards and any group left empty by the filter.
  const visibleGroups = useMemo(() => {
    if (showAll) return groups || [];
    const out = [];
    for (const g of groups || []) {
      const cards = g.cards.filter((c) => NEEDS_ATTENTION.has(c.health.status));
      if (cards.length > 0) out.push({ ...g, cards });
    }
    return out;
  }, [groups, showAll]);

  return (
    <div className="flex flex-col gap-5">
      {/* Toggle bar */}
      <div className="flex items-center justify-between">
        <MonoLabel>
          {showAll
            ? `All goals · ${totalCount}`
            : `Needs attention · ${attentionCount}`}
        </MonoLabel>
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="rounded-[var(--radius-sub)] border border-border bg-card px-2.5 py-1 text-[10px] uppercase tracking-[0.4px] text-muted-fg transition-colors hover:border-border-strong hover:text-fg"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {showAll ? `Focus · ${attentionCount} need you` : `Show all · ${totalCount}`}
        </button>
      </div>

      {visibleGroups.length === 0 ? (
        <AllClear total={totalCount} />
      ) : (
        visibleGroups.map((group) => (
          <GroupBlock key={group.l1.id} group={group} fillHref={fillHref} />
        ))
      )}
    </div>
  );
}

function GroupBlock({ group, fillHref }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline gap-2.5 border-b border-border pb-1.5">
        <span
          className="font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 15,
            letterSpacing: "-0.2px",
          }}
        >
          {group.l1.title}
        </span>
        {group.l1.category ? (
          <span
            className="text-[10px] uppercase tracking-[0.4px] text-muted-fg/70"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {group.l1.category}
          </span>
        ) : null}
        <span
          className="ml-auto text-[10px] tabular-nums text-muted-fg/70"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {group.cards.length} goal{group.cards.length === 1 ? "" : "s"}
        </span>
      </div>
      <div
        className={cn(
          "grid gap-3",
          "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
        )}
      >
        {group.cards.map((card) => (
          <GoalHealthCard
            key={card.goal.id}
            goal={card.goal}
            spec={card.spec}
            health={card.health}
            fillHref={fillHref}
          />
        ))}
      </div>
    </section>
  );
}

function AllClear({ total }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-md border border-dashed border-border bg-card/40 px-6 py-10 text-center">
      <div
        className="text-[15px] font-semibold text-fg"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Everything&rsquo;s up to date
      </div>
      <div className="text-[12px] text-muted-fg">
        All {total} tracked goals are on pace or auto-tracked. Nothing needs you
        right now.
      </div>
    </div>
  );
}

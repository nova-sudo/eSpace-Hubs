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
import { Button, Card, Label, Section } from "@/components/ui";
import { resolveCompletedWorkWeek } from "@/lib/date";
import { GoalHealthCard } from "./goal-health-card";
import { HEALTH, NEEDS_ATTENTION } from "./status";

export function GoalHealthGrid({ groups, fillHref }) {
  const [showAll, setShowAll] = useState(false);
  // The week inline "Fill now" writes against — the same most-recent
  // completed work-week the check-in page defaults to, so filling here is
  // identical to filling there. Resolved once per mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const week = useMemo(() => resolveCompletedWorkWeek(), []);

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
  const onPaceCount = useMemo(
    () =>
      (groups || []).reduce(
        (sum, g) =>
          sum +
          g.cards.filter((c) => c.health.status === HEALTH.ON_PACE || c.health.status === HEALTH.AUTO).length,
        0,
      ),
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
    <Section
      title="Full board"
      right={
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-muted-fg">
            {totalCount} goal{totalCount === 1 ? "" : "s"} · {onPaceCount} on pace
          </span>
          <Button variant="soft" size="sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? `Focus · ${attentionCount} need you` : `Show all · ${totalCount}`}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {visibleGroups.length === 0 ? (
          <AllClear total={totalCount} />
        ) : (
          visibleGroups.map((group) => (
            <GroupBlock key={group.l1.id} group={group} fillHref={fillHref} week={week} />
          ))
        )}
      </div>
    </Section>
  );
}

function GroupBlock({ group, fillHref, week }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline gap-2.5">
        <Label>
          {group.l1.title}
          {group.l1.category ? ` · ${group.l1.category}` : ""}
        </Label>
        <span className="ml-auto text-[12px] tabular-nums text-dim-fg">
          {group.cards.length} goal{group.cards.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {group.cards.map((card) => (
          <GoalHealthCard
            key={card.goal.id}
            goal={card.goal}
            spec={card.spec}
            health={card.health}
            trend={card.trend}
            fillHref={fillHref}
            week={week}
          />
        ))}
      </div>
    </section>
  );
}

function AllClear({ total }) {
  return (
    <Card tone="mint" padding={24} className="flex flex-col items-center gap-1.5 text-center">
      <div className="text-[15px] font-bold text-mint-ink">Everything&rsquo;s up to date</div>
      <div className="text-[13px] text-mint-ink/80">
        All {total} tracked goals are on pace or auto-tracked. Nothing needs you right now.
      </div>
    </Card>
  );
}

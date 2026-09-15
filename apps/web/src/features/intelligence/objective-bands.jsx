"use client";

/**
 * The board, as outline bands.
 *
 * Every objective is a band, not a card: a full-width header (number, title,
 * weakest-child status, paced bar, rolled-up percentage) with one row per
 * goal under it, separated by hairlines. Cards in a 3-up grid made twelve
 * goals look like twelve unrelated things; a band says "these four belong to
 * this objective" in the layout itself, and it holds the whole tree on one
 * screen — which is why the board no longer hides behind a disclosure.
 *
 * A row opens the same <GoalWidgetModal> the focus hero opens, so filling a
 * goal from the board never leaves the page. One modal for the whole block,
 * keyed by the selected card.
 */

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Badge, Card, FillStrip, Label, PacedBar } from "@/components/ui";
import { SPEC_KIND_META, specCadence } from "@/features/goal-specs";
import { TIER_LABELS, tierTone } from "@/features/goal-tiers";
import { GoalWidgetModal } from "@/features/goal-widgets";
import { AutoGoalValue } from "./auto-value";
import { cadenceCells, objectiveProgressPercent, worstChildStatus } from "./progress";
import { HEALTH } from "./status";

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function ObjectiveBands({ groups }) {
  // One modal for the block — a row sets the card it should show.
  const [active, setActive] = useState(null);

  return (
    <>
      <div className="flex flex-col gap-2.5">
        {(groups || []).map((group, i) => (
          <Band key={group.l1.id} group={group} index={i} onOpen={setActive} />
        ))}
      </div>

      <GoalWidgetModal
        open={!!active}
        onClose={() => setActive(null)}
        spec={active?.spec}
        goal={active?.goal}
      />
    </>
  );
}

function Band({ group, index, onOpen }) {
  const percent = objectiveProgressPercent(group.cards);
  const worst = worstChildStatus(group.cards);

  return (
    <Card padding={0}>
      <div className="flex items-center gap-3 bg-card-alt px-4 py-3 sm:px-5">
        <Label className="shrink-0 tabular-nums">{String(index + 1).padStart(2, "0")}</Label>
        <h3
          className="m-0 min-w-0 flex-1 truncate text-[14.5px] font-bold tracking-[-0.01em] text-fg"
          title={group.l1.title}
        >
          {group.l1.title}
        </h3>
        {worst ? <Badge tone={worst.tone}>{worst.label}</Badge> : null}
        <span className="hidden w-[120px] shrink-0 md:block">
          <PacedBar value={percent ?? 0} height={5} />
        </span>
        <span className="w-[36px] shrink-0 text-right text-[12px] font-bold tabular-nums text-muted-fg">
          {percent == null ? "—" : `${percent}%`}
        </span>
      </div>

      {group.cards.map((card) => (
        <GoalRow key={card.goal.id} card={card} onOpen={onOpen} />
      ))}
    </Card>
  );
}

function GoalRow({ card, onOpen }) {
  const { goal, spec, health, tier } = card;
  const kindLabel = SPEC_KIND_META[spec?.widget]?.label ?? "Goal";
  const cadence = specCadence(spec);
  const cells = cadenceCells(health?.fill);

  return (
    <button
      type="button"
      onClick={() => onOpen(card)}
      className="flex w-full items-center gap-3 border-t border-line px-4 py-3 text-left transition-colors hover:bg-card-alt sm:gap-3.5 sm:px-5"
    >
      <Label className="hidden w-[116px] shrink-0 truncate lg:block">
        {kindLabel}
        {cadence ? ` · ${capitalize(cadence)}` : ""}
      </Label>

      <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-fg" title={goal?.title}>
        {goal?.title || spec?.title || "Untitled goal"}
      </span>

      <span className="hidden w-[140px] shrink-0 md:block">
        {cells.length > 0 ? <FillStrip cells={cells} size="sm" /> : null}
      </span>

      <span className="hidden w-[84px] shrink-0 justify-end text-right text-[13px] font-extrabold tabular-nums text-fg sm:flex">
        <GoalRowValue card={card} />
      </span>

      <Badge tone={tier ? tierTone(tier) : "neutral"}>
        {tier ? TIER_LABELS[tier] : "Not graded"}
      </Badge>

      <ChevronRight size={15} className="shrink-0 text-muted-fg" aria-hidden="true" />
    </button>
  );
}

/**
 * The row's one number. Manual trackers read as filled-of-due windows — the
 * same ratio the Goals page's cadence stepper shows. AUTO trackers have no
 * windows, so they show the live value their integration produced.
 */
function GoalRowValue({ card }) {
  const { spec, health } = card;
  if (health?.status === HEALTH.AUTO) return <AutoGoalValue spec={spec} compact />;
  const fill = health?.fill;
  if (fill?.total > 0) {
    return (
      <span>
        {fill.filledCount}
        <span className="text-muted-fg">/{fill.total}</span>
      </span>
    );
  }
  if (fill?.hasData) return <span>Logged</span>;
  return <span className="text-dim-fg">—</span>;
}

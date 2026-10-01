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
import { SPEC_KIND_META, SPEC_VARIANTS, specCadence } from "@/features/goal-specs";
import { TIER_LABELS, tierTone } from "@/features/goal-tiers";
import { GoalWidgetModal } from "@/features/goal-widgets";
import { ASSIGNED_GROUP_LABEL, AssignedBadge } from "@/features/assigned-goals";
import { ASSIGNED_ROOT_ID } from "@espace-devhub/shared/goal-specs";
import { AutoGoalValue } from "./auto-value";
import { cadenceCells, objectiveProgressPercent, worstChildStatus } from "./progress";
import { GOAL_STATUS } from "@/features/goal-inputs";

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
  // Goals a manager assigned you sit under a synthetic objective the server
  // titles "Shared goals"; here they read "Assigned to you".
  const assigned = group.l1.id === ASSIGNED_ROOT_ID;
  const title = assigned ? ASSIGNED_GROUP_LABEL : group.l1.title;

  return (
    <Card padding={0}>
      <div className="flex items-center gap-3 bg-card-alt px-4 py-3 sm:px-5">
        <Label className="shrink-0 tabular-nums">{String(index + 1).padStart(2, "0")}</Label>
        <h3
          className="m-0 min-w-0 flex-1 truncate text-[14.5px] font-bold tracking-[-0.01em] text-fg"
          title={title}
        >
          {title}
        </h3>
        {assigned ? <AssignedBadge names={group.cards.map((c) => c.goal?.assigned?.byName)} /> : null}
        {worst ? <Badge tone={worst.tone}>{worst.label}</Badge> : null}
        <span className="hidden w-[120px] shrink-0 md:block">
          <PacedBar value={percent ?? 0} expected={100} height={5} />
        </span>
        <span
          className="w-[36px] shrink-0 text-right text-[12px] font-bold tabular-nums text-muted-fg"
          title="Logged so far: of the check-ins due under this objective, how many are logged"
        >
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

      <span
        title={
          tier
            ? `Achievement tier: ${TIER_LABELS[tier]}`
            : "Not graded yet — log data for this goal and it gets a tier"
        }
      >
        <Badge tone={tier ? tierTone(tier) : "neutral"}>
          {tier ? TIER_LABELS[tier] : "Not graded yet"}
        </Badge>
      </span>

      <ChevronRight size={15} className="shrink-0 text-muted-fg" aria-hidden="true" />
    </button>
  );
}

/**
 * The row's one number: logged of DUE so far — "4/5", never "4/19" (future
 * and pre-tracker windows aren't due). AUTO trackers have no windows, so
 * they show the live value their integration produced.
 */
function GoalRowValue({ card }) {
  const { spec, health, status } = card;
  // An AUTO tracker shows its live value whatever its status word — a graded
  // "Behind" auto goal used to fall through to "—".
  if (status?.status === GOAL_STATUS.AUTO || SPEC_KIND_META[spec?.widget]?.variant === SPEC_VARIANTS.AUTO) {
    return <AutoGoalValue spec={spec} compact />;
  }
  const logged = status?.logged;
  if (logged && logged.due > 0) {
    return (
      <span title={`${logged.done} of the ${logged.due} check-ins due so far are logged`}>
        {logged.done}
        <span className="text-muted-fg">/{logged.due}</span>
      </span>
    );
  }
  if (health?.fill?.hasData) return <span>Logged</span>;
  return <span className="text-muted-fg">—</span>;
}

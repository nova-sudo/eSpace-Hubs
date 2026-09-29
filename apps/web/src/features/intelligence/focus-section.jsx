"use client";

/**
 * The focus block — the point of the page.
 *
 * `queue` comes from useGoalHealth() already severity-sorted, so queue[0] IS
 * the top priority: it gets the full-width hero (status, signal, cadence
 * strip, the grader's reasoning, one ink action). Everything after it is a
 * single tinted line — lemon for "you haven't logged this", peach for
 * "you're behind on this" — because a second goal explained at hero size
 * stops being a priority and starts being a list.
 *
 * ONE fill modal for the whole block, owned here (not by the hero): logging
 * the first entry re-derives the queue, the hero re-keys to the next goal,
 * and a modal owned by the hero vanished mid-task. The open card is held by
 * value, so it survives the queue reordering underneath it.
 *
 * Presentation only; each card is pre-derived upstream.
 */

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui";
import { readinessLabel, GoalWidgetModal, GOAL_READINESS } from "@/features/goal-widgets";
import { specCadence } from "@/features/goal-specs";
import { cadenceWindowLabel, GOAL_STATUS } from "@/features/goal-inputs";
import { cn } from "@/lib/cn";
import { FocusHero } from "./focus-hero";

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * Peach for Behind (and a goal sent back), lemon for everything else in the
 * queue — the shared status's own tint, so a row can never disagree with the
 * hero above it or with the Goals page.
 */
export function queueRowTone(card) {
  if (card?.health?.readiness === GOAL_READINESS.REJECTED) return "peach";
  return card?.status?.status === GOAL_STATUS.BEHIND ? "peach" : "lemon";
}

/** One-line reason for a queue row, in the goal's own cadence terms. */
export function queueRowLine(card) {
  const { health, spec, tier, status } = card;
  if (health?.readiness === GOAL_READINESS.REJECTED) return "Changes requested";
  if (status?.status === GOAL_STATUS.NEEDS_SETUP) {
    return readinessLabel(health?.readiness) || status.label;
  }
  const cadence = specCadence(spec);
  const [periodNoun] = cadenceWindowLabel(cadence);
  if (status?.status === GOAL_STATUS.BEHIND) {
    return [status.label, status.reason].filter(Boolean).join(" · ");
  }
  if (status?.status === GOAL_STATUS.NOT_LOGGED) {
    return cadence ? `Not logged · ${capitalize(cadence)}` : "Not logged";
  }
  if (tier === "not_achieved") return "Graded Not achieved";
  // On pace, but this period still wants its entry — a chore, not a slip.
  if (health?.needsFill) return `${status?.label ?? "On pace"} · this ${periodNoun} not logged yet`;
  return status?.label ?? "Needs attention";
}

export function FocusSection({ queue, total }) {
  // The card whose widget is open in the modal — held by value so a queue
  // reorder (the usual result of filling it) can't close it under the user.
  const [active, setActive] = useState(null);

  if (!Array.isArray(queue) || queue.length === 0) {
    return <AllCaughtUp total={total} />;
  }
  const [lead, ...rest] = queue;
  return (
    <>
      <div className="flex flex-col gap-2.5">
        <FocusHero key={lead.goal.id} card={lead} onOpen={() => setActive(lead)} />
        {rest.map((card) => (
          <QueueRow key={card.goal.id} card={card} onOpen={() => setActive(card)} />
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

/** A queue row opens the same in-place modal the hero does — no detour to /goals. */
function QueueRow({ card, onOpen }) {
  const tone = queueRowTone(card);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-3 rounded-[var(--radius-lg)] px-4 py-3 text-left transition-opacity hover:opacity-90",
        tone === "peach" ? "bg-peach text-peach-ink" : "bg-lemon text-lemon-ink",
      )}
    >
      <span className="min-w-0 flex-1 truncate text-[14px] font-bold" title={card.goal.title}>
        {card.goal.title}
      </span>
      <span className="shrink-0 text-[12px] font-semibold">{queueRowLine(card)}</span>
      <ChevronRight size={15} className="shrink-0 opacity-70" aria-hidden="true" />
    </button>
  );
}

/**
 * Shown when the attention queue is empty. The queue holds every goal that
 * is sent back, graded Not achieved, gone quiet, behind target, never logged
 * or awaiting setup — so "empty" means exactly this, no more.
 */
function AllCaughtUp({ total }) {
  return (
    <Card tone="mint" padding={30} className="text-center">
      <div className="text-[22px] font-extrabold tracking-[-0.02em] text-mint-ink">All caught up.</div>
      <div className="mx-auto mt-2 max-w-[400px] text-[13.5px] leading-[1.5] text-mint-ink">
        Every one of your {total} goal{total === 1 ? "" : "s"} is logged for its current period and
        none is graded below Achieved. Nothing needs you right now.
      </div>
    </Card>
  );
}

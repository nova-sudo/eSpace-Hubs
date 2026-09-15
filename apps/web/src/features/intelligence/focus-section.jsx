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
 * Presentation only; each card is pre-derived upstream.
 */

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui";
import { readinessLabel } from "@/features/goal-widgets";
import { specCadence } from "@/features/goal-specs";
import { cadenceWindowLabel } from "@/features/goal-inputs";
import { cn } from "@/lib/cn";
import { FocusHero } from "./focus-hero";
import { HEALTH } from "./status";

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Lemon for not-logged / needs-setup, peach for behind / overdue. */
export function queueRowTone(health) {
  if (health?.overdue) return "peach";
  if (health?.status === HEALTH.BEHIND || health?.status === HEALTH.STALE) return "peach";
  return "lemon";
}

/** One-line status for a queue row, in the goal's own cadence terms. */
export function queueRowLine(card) {
  const { health, spec } = card;
  if (health?.status === HEALTH.NEEDS_SETUP) {
    return readinessLabel(health.readiness) || "Needs setup";
  }
  const cadence = specCadence(spec);
  if (health?.status === HEALTH.NO_DATA) {
    return cadence ? `Not logged yet · ${capitalize(cadence)}` : "Not logged yet";
  }
  if (health?.status === HEALTH.STALE) {
    const [singular, plural] = cadenceWindowLabel(cadence);
    const missed = health.missedWindows || 1;
    return `Gone quiet · ${missed} ${missed === 1 ? singular : plural}`;
  }
  if (health?.status === HEALTH.BEHIND) return "Behind target";
  return "Needs attention";
}

export function FocusSection({ queue, fillHref, total }) {
  if (!Array.isArray(queue) || queue.length === 0) {
    return <AllCaughtUp total={total} />;
  }
  const [lead, ...rest] = queue;
  return (
    <div className="flex flex-col gap-2.5">
      {/* key by goal id → the hero remounts when the queue reorders, so its
          modal state never carries onto a different goal. */}
      <FocusHero key={lead.goal.id} card={lead} />
      {rest.map((card) => (
        <QueueRow key={card.goal.id} card={card} fillHref={fillHref} />
      ))}
    </div>
  );
}

function QueueRow({ card, fillHref }) {
  const tone = queueRowTone(card.health);
  return (
    <Link
      href={fillHref}
      className={cn(
        "flex items-center gap-3 rounded-[var(--radius-lg)] px-4 py-3",
        tone === "peach" ? "bg-peach text-peach-ink" : "bg-lemon text-lemon-ink",
      )}
    >
      <span className="min-w-0 flex-1 truncate text-[14px] font-bold" title={card.goal.title}>
        {card.goal.title}
      </span>
      <span className="shrink-0 text-[12px] font-semibold opacity-80">{queueRowLine(card)}</span>
      <ChevronRight size={15} className="shrink-0 opacity-70" aria-hidden="true" />
    </Link>
  );
}

/** Shown when the attention queue is empty — everything's on pace. */
function AllCaughtUp({ total }) {
  return (
    <Card tone="mint" padding={30} className="text-center">
      <div className="text-[22px] font-extrabold tracking-[-0.02em] text-mint-ink">All caught up.</div>
      <div className="mx-auto mt-2 max-w-[380px] text-[13.5px] leading-[1.5] text-mint-ink/80">
        Every one of your {total} goals has reached Achieved or better. Nothing needs you right now.
      </div>
    </Card>
  );
}

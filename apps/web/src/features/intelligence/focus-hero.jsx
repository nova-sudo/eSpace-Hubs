"use client";

/**
 * Focus hero — the one goal in the carousel, big and decisive. Renders a card
 * from useGoalHealth (tier-ranked, worst first): a status badge, the primary
 * signal, the cadence fill strip, then EITHER the grader's reasoning (for a
 * Not-achieved goal) or a fill nudge, and a primary action that opens the
 * goal's widget in a MODAL — the ContextCollector for a needs-setup goal, or
 * the widget body + cadence stepper to fill/backfill missing periods — so
 * the user acts without leaving the page.
 *
 * The carousel's prev/next pager renders here (bottom-right of the action
 * row) via the optional `pager` prop; FocusCarousel still owns the index
 * state, this component just renders the two buttons.
 *
 * Presentation only — data comes pre-derived on the card.
 */

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge, Button, Card, FillStrip, IconButton, InsightRow, Label } from "@/components/ui";
import { SPEC_KIND_META, specCadence } from "@/features/goal-specs";
import { cadenceWindowLabel } from "@/features/goal-inputs";
import { readinessLabel, GoalWidgetModal } from "@/features/goal-widgets";
import { currentWindowKey } from "@/features/goal-locks";
import { skipWindow } from "./skip-window";
import { HEALTH } from "./status";

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function daysSince(ts) {
  if (!ts) return null;
  return Math.max(0, Math.round((Date.now() - ts) / 86_400_000));
}

/** Big-numeral signal per status — the one number the hero leads with. */
function heroSignal(health) {
  if (health?.status === HEALTH.NEEDS_SETUP) {
    return { big: "!", unit: "", sub: "not set up yet" };
  }
  const d = daysSince(health?.fill?.lastEntryTs);
  if (health?.status === HEALTH.NO_DATA || d == null) {
    return { big: "—", unit: "", sub: "never logged" };
  }
  if (health?.status === HEALTH.BEHIND) {
    return { big: String(d), unit: "d", sub: "since last logged · below target" };
  }
  return { big: String(d), unit: "d", sub: "since last logged" };
}

function statusChip(health) {
  if (health?.overdue) return { tone: "peach", label: "Gone quiet" };
  switch (health?.status) {
    case HEALTH.NEEDS_SETUP:
      return { tone: "lemon", label: "Needs setup" };
    case HEALTH.BEHIND:
      return { tone: "peach", label: "Behind target" };
    case HEALTH.STALE:
      return { tone: "lemon", label: "Gone quiet" };
    case HEALTH.NO_DATA:
    default:
      return { tone: "lemon", label: "Not logged yet" };
  }
}

export function FocusHero({ card, pager }) {
  const [modalOpen, setModalOpen] = useState(false);
  const { goal, spec, health, l1, tier, tierReasoning } = card;
  const needsSetup = health?.status === HEALTH.NEEDS_SETUP;
  // The carousel leads with the achievement tier, so a graded-failing goal reads
  // as "Not achieved" rather than by its fill status.
  const notAchieved = tier === "not_achieved";

  const chip = notAchieved ? { tone: "peach", label: "Not achieved" } : statusChip(health);
  const kindLabel = SPEC_KIND_META[spec?.widget]?.label ?? "Goal";
  const context = [kindLabel, l1?.category || l1?.title].filter(Boolean).join(" · ");
  const signal = heroSignal(health);

  const cadence = specCadence(spec);
  const windowKey = currentWindowKey(cadence);
  // Only a fill goal gets "Skip for now" — settling a window doesn't answer
  // setup questions or fix a failing tier.
  const canSkip = !needsSetup && !notAchieved && !!windowKey;

  const targetVal = spec?.manual?.target;
  const sub = [cadence ? capitalize(cadence) : null, targetVal?.value != null ? `target ${targetVal.op} ${targetVal.value}` : null]
    .filter(Boolean)
    .join(" · ");

  // Fill strip — cycle windows from deriveGoalHealth (oldest→newest objects),
  // capped to the 8 windows ENDING at the current one. total===0 = a
  // single-record/pip kind → no strip. Centre on currentIndex (not the array
  // tail): buildCycleWindows enumerates the whole calendar year, so the tail is
  // unstarted FUTURE windows.
  const fill = health?.fill;
  const STRIP_CAP = 8;
  const stripWindows = (() => {
    if (!fill || !fill.total || !Array.isArray(fill.windows)) return [];
    const idx = Number.isInteger(fill.currentIndex)
      ? fill.currentIndex
      : fill.windows.length - 1;
    return fill.windows.slice(Math.max(0, idx - STRIP_CAP + 1), idx + 1);
  })();
  const stripCells = stripWindows.map((w) => ({ key: w?.key, label: w?.label, state: w?.state || "future" }));
  const noun = cadenceWindowLabel(cadence)[1];

  let insight;
  if (notAchieved && tierReasoning) {
    insight = { text: tierReasoning, action: { label: "Why this grade", onClick: () => setModalOpen(true) } };
  } else if (needsSetup) {
    insight = { text: readinessLabel(health?.readiness) || "This goal needs setup before it can be tracked." };
  } else if (notAchieved) {
    insight = { text: "Graded “Not achieved” — fill more, or open it to see what it takes to reach the next tier." };
  } else {
    insight = { text: "This is your most-slipping goal right now. Logging it keeps the goal healthy — it takes about a minute." };
  }

  return (
    <>
      <Card padding={28} className="flex flex-col gap-5">
        <div className="flex items-center gap-2.5">
          <Badge dot tone={chip.tone}>
            {chip.label}
          </Badge>
          <Label>{context}</Label>
        </div>

        <div>
          <h2
            className="m-0 text-[22px] font-bold leading-[1.25] tracking-[-0.02em] text-fg"
            title={goal?.title}
          >
            {goal?.title || spec?.title || "Untitled goal"}
          </h2>
          {sub ? <div className="mt-1 text-[13.5px] text-muted-fg">{sub}</div> : null}
        </div>

        <div className="flex flex-wrap items-end gap-8">
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[56px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg">
                {signal.big}
              </span>
              {signal.unit ? <span className="text-[20px] font-semibold text-muted-fg">{signal.unit}</span> : null}
            </div>
            <div className="mt-1.5 text-[13px] text-muted-fg">{signal.sub}</div>
          </div>

          {stripCells.length > 0 ? (
            <div className="flex min-w-[220px] flex-1 flex-col gap-2">
              <div className="flex items-center justify-between text-[12.5px] font-semibold text-muted-fg">
                <span>Last {stripCells.length} {noun}</span>
                <span className="tabular-nums">
                  {fill.filledCount} of {fill.total} filled
                </span>
              </div>
              <FillStrip cells={stripCells} size="md" />
              <div className="flex items-center justify-between text-[11.5px] text-dim-fg">
                <span>{stripWindows[0]?.label}</span>
                <span>{stripWindows[stripWindows.length - 1]?.label}</span>
              </div>
            </div>
          ) : null}
        </div>

        <InsightRow tone="lav" action={insight.action}>
          {insight.text}
        </InsightRow>

        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" arrow onClick={() => setModalOpen(true)}>
            {needsSetup ? "Set up" : "Fill this window"}
          </Button>

          {canSkip ? (
            <Button
              variant="soft"
              size="lg"
              onClick={() => skipWindow(goal, windowKey)}
              title="Nothing to report this period — settle it and move on"
            >
              Skip for now
            </Button>
          ) : null}

          {pager && pager.count > 1 ? (
            <div className="ml-auto flex items-center gap-2">
              <IconButton
                label="Higher priority"
                size="sm"
                onCard
                disabled={pager.index === 0}
                onClick={pager.onPrev}
              >
                <ChevronLeft size={15} />
              </IconButton>
              <span className="text-[12.5px] tabular-nums text-dim-fg">
                {pager.index + 1} / {pager.count}
              </span>
              <IconButton
                label="Next priority"
                size="sm"
                onCard
                disabled={pager.index === pager.count - 1}
                onClick={pager.onNext}
              >
                <ChevronRight size={15} />
              </IconButton>
            </div>
          ) : null}
        </div>
      </Card>

      <GoalWidgetModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        spec={spec}
        goal={goal}
      />
    </>
  );
}

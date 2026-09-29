"use client";

/**
 * Focus hero — the ONE goal the page leads with, big and decisive. Renders
 * queue[0] from useGoalHealth (severity-sorted, worst first): a status badge,
 * the primary signal, the cadence fill strip, then EITHER the grader's
 * reasoning (for a Not-achieved goal) or a fill nudge, and a primary action
 * that opens the goal's widget in a MODAL — the ContextCollector for a
 * needs-setup goal, or the widget body + cadence stepper to fill/backfill
 * missing periods — so the user acts without leaving the page.
 *
 * The modal itself is owned by <FocusSection> (`onOpen`): this component
 * remounts whenever the queue reorders, and a modal owned here disappeared
 * the moment the user logged the first entry.
 *
 * There is no pager any more: the rest of the queue sits underneath as
 * one-line rows, which beats stepping through heroes one at a time to find
 * out what else is waiting.
 *
 * Presentation only — data comes pre-derived on the card.
 */

import { Badge, Button, Card, FillStrip, InsightRow, Label } from "@/components/ui";
import { SPEC_KIND_META, specCadence } from "@/features/goal-specs";
import { cadenceWindowLabel, composedCycleBounds, GOAL_STATUS } from "@/features/goal-inputs";
import { readinessLabel, GOAL_READINESS } from "@/features/goal-widgets";
import { currentWindowKey } from "@/features/goal-locks";
import { ASSIGNED_GROUP_LABEL } from "@/features/assigned-goals";
import { ASSIGNED_ROOT_ID } from "@espace-devhub/shared/goal-specs";
import { skipWindow } from "./skip-window";
import { cadenceCells } from "./progress";
import { fmtTarget } from "@/lib/fmt";

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function daysSince(ts) {
  if (!ts) return null;
  return Math.max(0, Math.round((Date.now() - ts) / 86_400_000));
}

/** Big-numeral signal — days since the last entry, the one number the hero leads with. */
function heroSignal(health, status) {
  if (status?.status === GOAL_STATUS.NEEDS_SETUP) {
    return { big: "!", unit: "", sub: "not set up yet" };
  }
  const d = daysSince(health?.fill?.lastEntryTs);
  if (d == null) return { big: "—", unit: "", sub: "never logged" };
  return { big: String(d), unit: d === 1 ? "day" : "days", sub: "since last logged" };
}

/** The badge: the shared status (a goal sent back reads "Changes requested"). */
function statusChip(health, status) {
  if (health?.readiness === GOAL_READINESS.REJECTED) {
    return { tone: "peach", label: "Changes requested" };
  }
  return { tone: status?.tone ?? "neutral", label: status?.label ?? "No tracker yet" };
}

export function FocusHero({ card, onOpen }) {
  const { goal, spec, health, status, l1, tier, tierReasoning } = card;
  const needsSetup = status?.status === GOAL_STATUS.NEEDS_SETUP;
  const sentBack = health?.readiness === GOAL_READINESS.REJECTED;
  // The queue leads with the achievement tier, so a graded-failing goal reads
  // as "Not achieved" rather than by its fill status.
  const notAchieved = tier === "not_achieved";

  const chip = statusChip(health, status);
  const kindLabel = SPEC_KIND_META[spec?.widget]?.label ?? "Goal";
  // The assigned-goals objective is titled "Shared goals" server-side; it
  // reads "Assigned to you" here ("Shared with me" is the viewer page).
  const l1Label = l1?.id === ASSIGNED_ROOT_ID ? ASSIGNED_GROUP_LABEL : l1?.category || l1?.title;
  const context = [kindLabel, l1Label].filter(Boolean).join(" · ");
  const signal = heroSignal(health, status);

  const cadence = specCadence(spec);
  const windowKey = currentWindowKey(cadence, new Date(), composedCycleBounds(spec));
  const [periodNoun, periodPlural] = cadenceWindowLabel(cadence);
  // Only a fill goal can settle its window — settling doesn't answer setup
  // questions or fix a failing tier.
  const canSkip = !needsSetup && !notAchieved && !!windowKey;

  const targetVal = spec?.manual?.target;
  const targetText = fmtTarget(targetVal);
  // The status's reason ("2 weeks missed") sits with the cadence and target,
  // so the badge and the words under it can't tell different stories.
  const sub = [status?.reason, cadence ? capitalize(cadence) : null, targetText ? `target ${targetText}` : null]
    .filter(Boolean)
    .join(" · ");
  const logged = status?.logged;

  // Fill strip — cycle windows from deriveGoalHealth (oldest→newest objects),
  // capped to the 8 windows ENDING at the current one. total===0 = a
  // single-record/pip kind → no strip.
  const fill = health?.fill;
  const stripCells = cadenceCells(fill, { cap: 8, endAtCurrent: true });

  let insight;
  if (notAchieved && tierReasoning) {
    // The modal opens on the widget (fill view), not scrolled to the tier
    // ladder — so the action says where it goes, not what it explains.
    insight = { text: tierReasoning, action: { label: "Open goal", onClick: onOpen } };
  } else if (sentBack) {
    insight = { text: readinessLabel(health?.readiness) };
  } else if (needsSetup) {
    insight = { text: readinessLabel(health?.readiness) || "This goal needs setup before it can be tracked." };
  } else if (notAchieved) {
    insight = { text: "Graded “Not achieved” — log more, or open it to see what it takes to reach the next tier." };
  } else if (status?.status === GOAL_STATUS.BEHIND) {
    insight = { text: "This is the goal slipping the most right now. Logging what's missing brings it back on pace — it takes about a minute." };
  } else if (status?.status === GOAL_STATUS.NOT_LOGGED) {
    insight = { text: "Nothing is logged here yet. The first entry takes about a minute." };
  } else {
    insight = { text: `You're on pace. This ${periodNoun}'s entry is still open — log it when you have it.` };
  }

  const primaryLabel = sentBack
    ? "Revise and resubmit"
    : needsSetup
      ? "Set up"
      : `Fill this ${periodNoun}`;

  return (
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
              <span>Last {stripCells.length} {periodPlural}</span>
              {logged && logged.due > 0 ? (
                <span
                  className="tabular-nums"
                  title={`Of the ${logged.due} ${periodPlural} due so far, ${logged.done} are logged. Weeks still to come and weeks before this tracker existed don't count.`}
                >
                  {logged.done} of {logged.due} {periodPlural} logged
                </span>
              ) : null}
            </div>
            <FillStrip cells={stripCells} size="md" />
            <div className="flex items-center justify-between text-[11.5px] text-muted-fg">
              <span>{stripCells[0]?.label}</span>
              <span>{stripCells[stripCells.length - 1]?.label}</span>
            </div>
          </div>
        ) : null}
      </div>

      <InsightRow tone="lav" action={insight.action}>
        {insight.text}
      </InsightRow>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" arrow onClick={onOpen}>
          {primaryLabel}
        </Button>

        {canSkip ? (
          // This is NOT a snooze: it marks the period as done with no entry
          // and counts it as on pace. The label and tooltip say so.
          <Button
            variant="soft"
            size="lg"
            onClick={() => skipWindow(goal, windowKey)}
            title={`Marks this ${periodNoun} as done with nothing to log. It counts as on pace and won't come back — undo from the toast, or reopen the period from the goal's stepper.`}
          >
            Nothing to report this {periodNoun}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

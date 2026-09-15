"use client";

/**
 * One report's goals as a consistency check: the AI's verdict, your
 * grade, and the delta between them, on one scale.
 *
 * "Did I grade this person's twelve goals the same way" is a question a
 * lead actually has and no product answers — a per-goal drawer can't,
 * because it only ever shows one goal. The Delta column is the point.
 *
 * Agreement is a recorded act, never a blank: a row with no manager
 * verdict reads "Not set", and "Accept AI verdict" writes a real manager
 * verdict equal to the AI's tier (PUT …/verdict, same write the drawer
 * makes, same notification to the engineer).
 */

import { useState } from "react";
import { toast } from "sonner";
import { Button, Label } from "@/components/ui";
import { TIER_LABELS, tierDelta } from "@/features/goal-tiers";
import { cn } from "@/lib/cn";
import { EmptyCard, TierBadge, TierSpreadBar } from "./manager-ui";
import { saveGoalVerdict } from "./verdict-api";

const COLS =
  "grid grid-cols-[minmax(180px,2fr)_72px_128px_128px_64px_150px] items-center gap-3";

/** The rung move as a signed number — the one thing a spread can't say. */
function DeltaCell({ aiTier, managerTier }) {
  if (!managerTier || !aiTier) {
    return <span className="text-[12.5px] tabular-nums text-dim-fg">—</span>;
  }
  const move = tierDelta(aiTier, managerTier);
  if (!move) {
    return <span className="text-[12.5px] tabular-nums text-dim-fg">—</span>;
  }
  const signed = move.direction === "up" ? `+${move.steps}` : `−${move.steps}`;
  return (
    <span
      title={move.label}
      className={cn(
        "text-[12.5px] font-extrabold tabular-nums",
        move.direction === "up" ? "text-sky-ink" : "text-peach-ink",
      )}
    >
      {signed}
    </span>
  );
}

export function EmployeeConsistencyView({ user, summary, groups, userId, onGrade, onSaved }) {
  const [accepting, setAccepting] = useState(null);

  const rows = groups.flatMap((group) =>
    group.goals.map((goal) => ({
      goal,
      objective: group.l1.title,
      weight: group.l1.weightage,
    })),
  );

  async function acceptAi(goal) {
    setAccepting(goal.id);
    const r = await saveGoalVerdict({
      userId,
      goalId: goal.id,
      tier: goal.aiTier,
      note: "Agreed with the AI verdict.",
    });
    setAccepting(null);
    if (r.ok) {
      toast.success(`Graded · ${TIER_LABELS[goal.aiTier]}`, {
        description: `${user.displayName.split(" ")[0]} has been notified.`,
      });
      onSaved?.();
    } else {
      toast.error("Couldn't save the grade", {
        description: r.error?.message || "Try again in a moment.",
      });
    }
  }

  if (rows.length === 0) {
    return (
      <EmptyCard>
        {user.displayName.split(" ")[0]} hasn&apos;t set up any goals yet —
        there&apos;s nothing to compare.
      </EmptyCard>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-[var(--radius-xl)] bg-card"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="overflow-x-auto">
        <div className="min-w-[860px] px-5 pb-5 pt-4">
          <div className={cn(COLS, "border-b border-line pb-2.5")}>
            <Label>Goal</Label>
            <Label>Weight</Label>
            <Label>AI verdict</Label>
            <Label>Your grade</Label>
            <Label>Delta</Label>
            <span />
          </div>

          {rows.map(({ goal, objective, weight }) => {
            const managerTier =
              goal.tier?.source === "manager" ? goal.tier.tier : null;
            return (
              <div key={goal.id} className={cn(COLS, "border-b border-line py-3")}>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-bold text-fg">
                    {goal.title}
                  </div>
                  <div className="truncate text-[11.5px] text-muted-fg">
                    {objective}
                  </div>
                </div>
                <span className="text-[12.5px] font-bold tabular-nums text-muted-fg">
                  {weight ? `${weight}%` : "—"}
                </span>
                <span>
                  <TierBadge tier={goal.aiTier} fallback="Not graded" />
                </span>
                <span>
                  <TierBadge tier={managerTier} fallback="Not set" />
                </span>
                <DeltaCell aiTier={goal.aiTier} managerTier={managerTier} />
                <div className="flex justify-end gap-2">
                  {!managerTier && goal.aiTier ? (
                    <Button
                      type="button"
                      variant="soft"
                      size="sm"
                      disabled={accepting === goal.id}
                      onClick={() => acceptAi(goal)}
                    >
                      {accepting === goal.id ? "Saving…" : "Accept AI verdict"}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant={managerTier ? "soft" : "ink"}
                    size="sm"
                    onClick={() => onGrade(goal)}
                  >
                    {managerTier ? "Regrade" : "Grade"}
                  </Button>
                </div>
              </div>
            );
          })}

          <div className="mt-3.5 flex items-center gap-3">
            <span className="shrink-0 text-[12px] text-muted-fg">
              Spread across this person:
            </span>
            <TierSpreadBar byTier={summary.byTier} height={8} />
          </div>
        </div>
      </div>
    </div>
  );
}

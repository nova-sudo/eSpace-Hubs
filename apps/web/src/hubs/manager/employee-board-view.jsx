"use client";

/**
 * One report's goals, grouped under their objective bands.
 *
 * The band header carries the objective's WEIGHTAGE — "20% of the year"
 * — which the API has always returned and the board never showed, so a
 * lead reading five goals had no idea which of them the year actually
 * hangs on. Where the person stands, and the packet they submitted, move
 * into a rail so the goal rows get their width back instead of being
 * crushed by three chips and a button on one flex line.
 */

import { Badge, Button, Card, Label } from "@/components/ui";
import { readinessLabel } from "@/features/goal-widgets";
import { ago } from "./manager-format";
import {
  CountTile,
  EmptyCard,
  TierBadge,
  TierSpreadBar,
  TierSpreadLegend,
} from "./manager-ui";
import { ReviewPacketCard } from "./review-packet-card";

const STATUS_META = {
  auto: { label: "Auto-tracked", tone: "lav" },
  tracking: { label: "Tracking", tone: "mint" },
  no_data: { label: "No data", tone: "lemon" },
  needs_setup: { label: "Needs setup", tone: "neutral" },
  delegated: { label: "Delegated", tone: "lav" },
  untrackable: { label: "Untrackable", tone: "neutral" },
  unclassified: { label: "Not classified", tone: "neutral" },
};

function StatusChip({ goal }) {
  const meta = STATUS_META[goal.status] ?? STATUS_META.unclassified;
  const label =
    goal.status === "delegated" && goal.delegatedJudge === "manager"
      ? "Delegated to you"
      : meta.label;
  return <Badge tone={meta.tone}>{label}</Badge>;
}

export function EmployeeBoardView({ user, summary, groups, userId, onGrade }) {
  const hasGoals = summary.total > 0;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="grid gap-3">
        {!hasGoals ? (
          <EmptyCard>
            {user.displayName.split(" ")[0]} hasn&apos;t set up any goals yet.
            Once they add goals in their hub, their board shows up here.
          </EmptyCard>
        ) : (
          groups.map((group) => (
            <div
              key={group.l1.id}
              className="overflow-hidden rounded-[var(--radius-xl)] bg-card"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <div className="flex flex-wrap items-center gap-2.5 bg-card-alt px-5 py-3">
                <span className="min-w-0 flex-1 text-[13.5px] font-bold text-fg">
                  {group.l1.title}
                </span>
                {group.l1.category ? (
                  <Badge>{group.l1.category}</Badge>
                ) : null}
                {group.l1.weightage ? (
                  <Badge tone="lav">{group.l1.weightage}% of the year</Badge>
                ) : null}
              </div>

              {group.goals.map((goal) => {
                const notReady = goal.readiness && goal.readiness !== "ready";
                const sub = notReady ? readinessLabel(goal.readiness) : goal.kindLabel;
                const activity = ago(goal.lastActivityAt);
                return (
                  <div
                    key={goal.id}
                    className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3.5"
                  >
                    <div className="min-w-[200px] flex-1">
                      <div className="text-[13.5px] font-bold text-fg">
                        {goal.title}
                      </div>
                      <div className="mt-0.5 truncate text-[11.5px] text-muted-fg">
                        {[sub, activity ? `updated ${activity}` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                      {/* #238: the frozen headline from the report's latest
                          review packet — a real number for AUTO goals instead
                          of the bare "auto" label. Dated so it's never read as
                          live. */}
                      {goal.reading ? (
                        <div
                          className="mt-1 text-[12px] text-fg"
                          title={`From the review packet submitted ${ago(goal.readingAsOf) || "recently"}`}
                        >
                          {goal.reading}
                          <span className="text-dim-fg">
                            {" "}
                            · as of packet {ago(goal.readingAsOf) || ""}
                          </span>
                        </div>
                      ) : null}
                      {goal.tier?.source === "manager" ? (
                        <div className="mt-1 text-[11.5px] font-semibold text-muted-fg">
                          Graded by {goal.tier.gradedByName || "you"}
                          {ago(goal.tier.gradedAt) ? ` · ${ago(goal.tier.gradedAt)}` : ""}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-none items-center gap-2">
                      <StatusChip goal={goal} />
                      <TierBadge tier={goal.tier?.tier} />
                      <Button
                        type="button"
                        variant={goal.tier?.source === "manager" ? "soft" : "ink"}
                        size="sm"
                        onClick={() => onGrade(goal)}
                      >
                        {goal.tier?.source === "manager" ? "Regrade" : "Grade"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="grid gap-3">
        <Card padding={18}>
          <Label>Where they stand</Label>
          <TierSpreadBar byTier={summary.byTier} height={9} className="mt-2" />
          <TierSpreadLegend
            byTier={summary.byTier}
            total={summary.total}
            className="mt-2.5"
          />
          <div className="mt-3.5 grid grid-cols-2 gap-2.5">
            <CountTile label="Goals" value={summary.total} />
            <CountTile label="Graded" value={summary.graded} />
            <CountTile label="Need setup" value={summary.needsSetup} />
            <CountTile label="Delegated to you" value={summary.delegatedToYou} />
          </div>
        </Card>

        {/* The frozen evidence document this report submitted (F1) — the
            artifact you grade against, not a live recompute. */}
        <ReviewPacketCard userId={userId} />
      </div>
    </div>
  );
}

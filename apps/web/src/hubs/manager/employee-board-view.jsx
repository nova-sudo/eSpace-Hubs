"use client";

/**
 * One report's goals, grouped under their objective bands.
 *
 * The band header carries the objective's WEIGHTAGE — "Weight 20%"
 * — which the API has always returned and the board never showed, so a
 * lead reading five goals had no idea which of them the year actually
 * hangs on. Where the person stands, and the packet they submitted, move
 * into a rail so the goal rows get their width back instead of being
 * crushed by three chips and a button on one flex line.
 */

import { Badge, Button, Card, Label } from "@/components/ui";
import { readinessLabel } from "@/features/goal-widgets";
import { ago, goalStatusMeta, statusLine } from "./manager-format";
import {
  CountTile,
  EmptyCard,
  TierBadge,
  TierSpreadBar,
  TierSpreadLegend,
} from "./manager-ui";
import { ReviewPacketCard } from "./review-packet-card";
import { ReportTrendCard } from "./report-trend-card";

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
                  <Badge>Weight {group.l1.weightage}%</Badge>
                ) : null}
              </div>

              {group.goals.map((goal) => {
                const notReady = goal.readiness && goal.readiness !== "ready";
                const status = goalStatusMeta(goal);
                const graded = Boolean(goal.tier?.tier);
                const activity = ago(goal.lastActivityAt);
                const sub = notReady
                  ? readinessLabel(goal.readiness, {
                      audience: "manager",
                      name: user.displayName,
                    })
                  : statusLine(goal);
                return (
                  <div
                    key={goal.id}
                    className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3.5"
                  >
                    <div className="min-w-[200px] flex-1">
                      <div className="text-[13.5px] font-bold text-fg">
                        {goal.title}
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-muted-fg">
                        {/* Status lives in the sub-line when the row's one
                            badge is the grade. */}
                        {graded && !notReady ? (
                          <span className="font-bold text-fg">{sub}</span>
                        ) : (
                          sub
                        )}
                        {[goal.kindLabel, activity ? `last logged ${activity}` : null]
                          .filter(Boolean)
                          .map((x) => ` · ${x}`)
                          .join("")}
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
                          <span className="text-muted-fg">
                            {" "}
                            · as of packet {ago(goal.readingAsOf) || ""}
                          </span>
                        </div>
                      ) : null}
                      {goal.tier?.source === "manager" ? (
                        <div className="mt-1 text-[11.5px] font-semibold text-muted-fg">
                          Graded by {goal.tier.gradedByName || "you"}
                          {ago(goal.tier.gradedAt) ? ` · ${ago(goal.tier.gradedAt)}` : ""}
                          {goal.tier.ack
                            ? goal.tier.ack.disagree
                              ? ""
                              : " · seen"
                            : " · not seen yet"}
                        </div>
                      ) : null}
                      {goal.tier?.ack?.disagree ? (
                        <div className="mt-1.5 rounded-[var(--radius-lg)] bg-peach px-3 py-2 text-[12px] leading-snug text-peach-ink">
                          <b>{user.displayName.split(" ")[0]} disagrees</b>
                          {goal.tier.ack.note ? ` — ${goal.tier.ack.note}` : ""}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-none items-center gap-2">
                      {/* One badge per row: the grade once there is one,
                          otherwise the shared status. */}
                      {graded ? (
                        <TierBadge tier={goal.tier.tier} />
                      ) : goal.delegatedJudge === "manager" ? (
                        <Badge tone="lav">Delegated to you</Badge>
                      ) : (
                        <Badge tone={status.tone} dot>
                          {status.label}
                        </Badge>
                      )}
                      <Button
                        type="button"
                        variant="soft"
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
            <CountTile label="Needs setup" value={summary.needsSetup} />
            <CountTile label="Delegated to you" value={summary.delegatedToYou} />
          </div>
        </Card>

        {/* The frozen evidence document this report submitted (F1) — the
            artifact you grade against, not a live recompute. */}
        <ReviewPacketCard userId={userId} personName={user?.displayName} />

        {/* Weekly snapshot headline — whether they're trending up. */}
        <ReportTrendCard userId={userId} />
      </div>
    </div>
  );
}

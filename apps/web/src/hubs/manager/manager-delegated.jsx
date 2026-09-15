"use client";

/**
 * Manager Hub — Delegated queue. Renders at /[hub]/delegated.
 *
 * Goals across all your reports marked "manager evaluates" (the dev
 * delegated judgement to you — no self-tracking). Each opens the same
 * grading drawer as the employee board; ungraded ones are surfaced first.
 *
 * Two things this view owes you that it used to swallow:
 *   - HOW LONG it has been waiting. A queue with no age can't be
 *     triaged: "3 delegated goals" says nothing about the one that has
 *     been sitting since August.
 *   - WHAT YOU DECIDED. A graded item showed a tier and nothing else —
 *     not the date, not the note you wrote — and re-opening it handed
 *     the drawer an empty note, which then saved straight over the
 *     reasoning the engineer had been given.
 *
 * Data: GET /manager/delegated-queue.
 */

import { useMemo, useState } from "react";
import { Avatar, Badge, Button, Card, SegmentedControl, PageHeader } from "@/components/ui";
import { TIER_LABELS } from "@/features/goal-tiers";
import { useDelegatedQueue } from "./use-delegated-queue";
import { ManagerGradeDrawer } from "./manager-grade-drawer";
import { EmptyCard, TierBadge } from "./manager-ui";
import { daysWaiting, onDate, waitedFor } from "./manager-format";

const FILTERS = ["awaiting", "graded", "all"];

export function ManagerDelegated() {
  const { loading, items, error, refresh } = useDelegatedQueue();
  const [grading, setGrading] = useState(null);
  const [filter, setFilter] = useState("awaiting");

  const pending = items.filter((it) => !it.verdict).length;
  const graded = items.length - pending;

  const shown = useMemo(() => {
    const rows = items.filter((it) => {
      if (filter === "awaiting") return !it.verdict;
      if (filter === "graded") return !!it.verdict;
      return true;
    });
    // Oldest first inside each bucket — the thing that has been sitting
    // longest is the thing you are most likely to owe an answer on.
    return [...rows].sort(
      (a, b) =>
        daysWaiting(b.verdict?.gradedAt ?? b.since) -
        daysWaiting(a.verdict?.gradedAt ?? a.since),
    );
  }, [items, filter]);

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-16 pt-7 sm:px-10">
      <PageHeader
        crumb="Delegated to you · your judgement required"
        title="Goals only you can score."
        subtitle="These reports marked a goal “manager evaluates” — there's no self-tracking, so it stays open until you grade it."
        right={
          <SegmentedControl
            size="sm"
            value={filter}
            onChange={(v) => FILTERS.includes(v) && setFilter(v)}
            options={[
              { value: "awaiting", label: "Awaiting you", count: pending },
              { value: "graded", label: "Graded", count: graded },
              { value: "all", label: "All", count: items.length },
            ]}
          />
        }
      />

      <div className="grid max-w-[900px] gap-3">
        {error ? (
          <EmptyCard>
            Couldn&apos;t load your delegated goals right now. Refresh, or check
            back in a moment.
          </EmptyCard>
        ) : loading ? (
          <EmptyCard>Loading…</EmptyCard>
        ) : items.length === 0 ? (
          <EmptyCard>
            No goals are delegated to you right now. When a report marks a goal
            “manager evaluates,” it shows up here for your verdict.
          </EmptyCard>
        ) : shown.length === 0 ? (
          <EmptyCard>
            {filter === "awaiting"
              ? "Nothing is waiting on your judgement — every delegated goal is graded."
              : "Nothing graded yet."}
          </EmptyCard>
        ) : (
          shown.map((it) => {
            const waited = waitedFor(it.since);
            return (
              <Card key={`${it.user.id}:${it.goal.id}`} padding={18}>
                <div className="flex items-start gap-3">
                  <Avatar
                    name={it.user.displayName}
                    size={32}
                    tone={it.verdict ? "lav" : "lemon"}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-bold text-fg">
                        {it.user.displayName}
                      </span>
                      <span className="text-[11.5px] text-muted-fg">
                        {[it.user.role, it.user.department].filter(Boolean).join(" · ")}
                      </span>
                      <span className="flex-1" />
                      {it.verdict ? (
                        <TierBadge tier={it.verdict.tier} />
                      ) : (
                        <Badge tone="lemon">Awaiting you</Badge>
                      )}
                      {waited && !it.verdict ? (
                        <Badge>waiting {waited}</Badge>
                      ) : null}
                    </div>

                    <h3 className="mt-1.5 text-[14.5px] font-bold text-fg">
                      {it.goal.title}
                    </h3>

                    {it.note ? (
                      <div className="mt-2 flex flex-wrap items-baseline gap-2 rounded-[var(--radius-lg)] bg-card-alt px-3 py-2.5">
                        <span className="shrink-0 text-[11px] font-bold text-muted-fg">
                          Their note
                        </span>
                        <span className="min-w-0 flex-1 text-[12.5px] leading-[1.5] text-fg">
                          {it.note}
                        </span>
                      </div>
                    ) : null}

                    {/* What you decided, and what you said when you decided
                        it — the note the drawer now re-opens with. */}
                    {it.verdict ? (
                      <div className="mt-2 rounded-[var(--radius-lg)] bg-mint px-3 py-2.5 text-mint-ink">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="shrink-0 text-[11px] font-bold">
                            You graded
                          </span>
                          <span className="min-w-0 flex-1 text-[12.5px] leading-[1.5]">
                            <b>{TIER_LABELS[it.verdict.tier] ?? it.verdict.tier}</b>
                            {onDate(it.verdict.gradedAt)
                              ? ` on ${onDate(it.verdict.gradedAt)}`
                              : ""}
                            {it.verdict.gradedByName
                              ? ` by ${it.verdict.gradedByName}`
                              : ""}
                            {it.verdict.note ? ` — “${it.verdict.note}”` : ""}
                          </span>
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center gap-2.5">
                      {it.kindLabel ? (
                        <span className="text-[11.5px] text-muted-fg">
                          {it.kindLabel}
                        </span>
                      ) : null}
                      <span className="flex-1" />
                      <Button
                        type="button"
                        variant={it.verdict ? "soft" : "ink"}
                        size="sm"
                        onClick={() =>
                          setGrading({
                            id: it.goal.id,
                            title: it.goal.title,
                            kindLabel: it.kindLabel,
                            userId: it.user.id,
                            userName: it.user.displayName,
                            tier: it.verdict
                              ? {
                                  tier: it.verdict.tier,
                                  source: "manager",
                                  // The note you wrote, so re-opening
                                  // edits it instead of erasing it.
                                  reasoning: it.verdict.note ?? "",
                                  gradedByName: it.verdict.gradedByName,
                                }
                              : null,
                          })
                        }
                      >
                        {it.verdict ? "Change grade" : "Grade this goal"}
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>

      <ManagerGradeDrawer
        open={!!grading}
        goal={grading}
        userId={grading?.userId}
        userName={grading?.userName}
        onClose={() => setGrading(null)}
        onSaved={() => {
          setGrading(null);
          refresh();
        }}
      />
    </main>
  );
}

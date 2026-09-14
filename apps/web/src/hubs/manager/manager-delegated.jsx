"use client";

/**
 * Manager Hub — Delegated queue. Renders at /[hub]/delegated.
 *
 * Goals across all your reports marked "manager evaluates" (the dev
 * delegated judgement to you — no self-tracking). Each opens the same
 * grading drawer as the employee board; ungraded ones are surfaced first.
 *
 * Data: GET /manager/delegated-queue.
 */

import { useState } from "react";
import { Badge, Button, Label, PageHeader } from "@/components/ui";
import { TIER_LABELS } from "@/features/goal-tiers";
import { useDelegatedQueue } from "./use-delegated-queue";
import { ManagerGradeDrawer } from "./manager-grade-drawer";

function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

const TIER_TONE = {
  not_achieved: "peach",
  achieved: "neutral",
  over_achieved: "mint",
  role_model: "lav",
};

function VerdictChip({ verdict }) {
  if (!verdict) return <Badge tone="lav">Awaiting your grade</Badge>;
  const tone = TIER_TONE[verdict.tier] ?? "neutral";
  return <Badge tone={tone}>{TIER_LABELS[verdict.tier] ?? verdict.tier}</Badge>;
}

export function ManagerDelegated() {
  const { loading, items, error, refresh } = useDelegatedQueue();
  const [grading, setGrading] = useState(null);

  const pending = items.filter((it) => !it.verdict).length;

  return (
    <main className="max-w-[1280px] mx-auto px-4 sm:px-10 pb-16 pt-7">
      <PageHeader
        crumb="Delegated to you · your judgement required"
        title="Goals only you can score."
        subtitle="These reports marked a goal “manager evaluates” — there's no self-tracking, so it stays open until you grade it."
      />

      <Label>
        {loading ? "Loading…" : `${items.length} delegated · ${pending} awaiting you`}
      </Label>

      <div className="mt-3 grid gap-3">
        {error ? (
          <EmptyCard>
            Couldn't load your delegated goals right now. Refresh, or check
            back in a moment.
          </EmptyCard>
        ) : loading ? (
          <EmptyCard>Loading…</EmptyCard>
        ) : items.length === 0 ? (
          <EmptyCard>
            No goals are delegated to you right now. When a report marks a
            goal “manager evaluates,” it shows up here for your verdict.
          </EmptyCard>
        ) : (
          items.map((it) => (
            <div
              key={`${it.user.id}:${it.goal.id}`}
              className="rounded-[var(--radius-xl)] bg-card p-5"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[11.5px] text-muted-fg">
                    <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-card-alt text-[11px] font-bold">
                      {initials(it.user.displayName)}
                    </span>
                    {[it.user.displayName, it.user.role, it.user.department]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  <h3 className="mt-2 text-[16px] font-bold">{it.goal.title}</h3>
                  {it.note ? (
                    <p className="mt-1.5 max-w-[62ch] text-[13px] leading-[1.5] text-muted-fg">
                      {it.note}
                    </p>
                  ) : null}
                </div>
                <VerdictChip verdict={it.verdict} />
              </div>

              <div className="mt-4 flex items-center gap-3">
                <Button
                  type="button"
                  variant="ink"
                  size="sm"
                  onClick={() =>
                    setGrading({
                      id: it.goal.id,
                      title: it.goal.title,
                      userId: it.user.id,
                      userName: it.user.displayName,
                      tier: it.verdict
                        ? {
                            tier: it.verdict.tier,
                            source: "manager",
                            reasoning: "",
                            gradedByName: it.verdict.gradedByName,
                          }
                        : null,
                    })
                  }
                >
                  {it.verdict ? "Update grade" : "Grade this goal"}
                </Button>
                {it.kindLabel ? (
                  <span className="text-[11px] text-dim-fg">{it.kindLabel}</span>
                ) : null}
              </div>
            </div>
          ))
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

function EmptyCard({ children }) {
  return (
    <div
      className="rounded-[var(--radius-xl)] bg-card p-6 text-[13px] leading-[1.6] text-muted-fg"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      {children}
    </div>
  );
}

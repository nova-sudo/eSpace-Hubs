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
import { MonoLabel, PageHeader } from "@/components/ui";
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
  not_achieved: "var(--bad)",
  achieved: "var(--muted-fg)",
  over_achieved: "var(--good)",
  role_model: "var(--accent)",
};

function VerdictChip({ verdict }) {
  if (!verdict) {
    return (
      <span
        className="inline-flex items-center rounded-full px-2.5 py-1"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "var(--accent)",
          background: "var(--accent-dim)",
        }}
      >
        Awaiting your grade
      </span>
    );
  }
  const c = TIER_TONE[verdict.tier] ?? "var(--muted-fg)";
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color: c,
        background: `color-mix(in srgb, ${c} 13%, transparent)`,
      }}
    >
      {TIER_LABELS[verdict.tier] ?? verdict.tier}
    </span>
  );
}

export function ManagerDelegated() {
  const { loading, items, error, refresh } = useDelegatedQueue();
  const [grading, setGrading] = useState(null);

  const pending = items.filter((it) => !it.verdict).length;

  return (
    <main className="relative z-[2] mx-auto max-w-4xl px-10 pb-16 pt-9">
      <PageHeader
        crumb="Delegated to you · your judgement required"
        title="Goals only you can score."
        italicWord="you"
        subtitle="These reports marked a goal “manager evaluates” — there's no self-tracking, so it stays open until you grade it."
      />

      <div className="mt-2">
        <MonoLabel>
          {loading
            ? "Loading…"
            : `${items.length} delegated · ${pending} awaiting you`}
        </MonoLabel>

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
                className="rounded-md border border-border bg-card p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div
                      className="flex items-center gap-2 text-muted-fg"
                      style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.03em" }}
                    >
                      <span
                        className="grid h-5 w-5 flex-none place-items-center rounded-full bg-panel-2"
                        style={{ fontSize: 9, fontWeight: 700 }}
                      >
                        {initials(it.user.displayName)}
                      </span>
                      {[it.user.displayName, it.user.role, it.user.department]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    <h3 className="mt-2 text-[16px] font-semibold">
                      {it.goal.title}
                    </h3>
                    {it.note ? (
                      <p className="mt-1.5 max-w-[62ch] text-[13px] leading-[1.5] text-muted-fg">
                        {it.note}
                      </p>
                    ) : null}
                  </div>
                  <VerdictChip verdict={it.verdict} />
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <button
                    type="button"
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
                    className="rounded-md px-3.5 py-2 text-[13px] font-semibold text-accent-on"
                    style={{ background: "var(--accent)" }}
                  >
                    {it.verdict ? "Update grade" : "Grade this goal"}
                  </button>
                  {it.kindLabel ? (
                    <span
                      className="text-dim-fg"
                      style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: "0.04em" }}
                    >
                      {it.kindLabel}
                    </span>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
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
    <div className="rounded-md border border-dashed border-border bg-card p-6 text-[13px] leading-[1.6] text-muted-fg">
      {children}
    </div>
  );
}

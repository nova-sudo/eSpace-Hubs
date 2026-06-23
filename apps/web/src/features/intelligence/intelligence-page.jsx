"use client";

/**
 * Goal Intelligence Hub — the app's home surface (Dev hub).
 *
 * Replaces the old performance bento. Where that page showed raw
 * integration metrics, this one shows what those metrics MEAN for the
 * user's goals: where they stand, what needs filling, what's on pace.
 *
 * Composition (top → bottom):
 *   1. StatusNarrative   — one-line "where you stand" (rule-based in
 *                          Sprint 1; AI-driven in Sprint 2, same slot)
 *   2. ActionQueue       — the do-next list, only when something's due
 *   3. GoalHealthGrid    — every classified goal as a health card
 *
 * Data comes from two shared-domain hooks only (useGoalWidgetItems +
 * useGoalHealth) — no product-surface imports, no integration tiles.
 */

import Link from "next/link";
import { Button, Loader, PageHeader, Reveal } from "@/components/ui";
import { useGoalWidgetItems } from "@/features/goal-widgets";
import { useHubLink } from "@/features/hubs";
import { StatusNarrative } from "./status-narrative";
import { ActionQueue } from "./action-queue";
import { GoalHealthGrid } from "./goal-health-grid";
import { useGoalHealth } from "./use-goal-health";

export function IntelligencePage() {
  const {
    groupedItems,
    hasGoals,
    hasSpecs,
    unclassifiedGoals,
    ready: itemsReady,
  } = useGoalWidgetItems();
  const { ready: inputsReady, groups, queue, summary } = useGoalHealth(groupedItems);

  const link = useHubLink();
  // Filling now lives on the Goals page (per-widget cadence stepper); the
  // standalone check-in page is retired.
  const fillHref = link("/goals");

  const loading = !itemsReady || !inputsReady;

  return (
    <main className="relative z-[2] px-10 pb-14 pt-9">
      <PageHeader
        crumb="Goal intelligence"
        title="Where you stand."
        italicWord="stand"
        subtitle="Your goals, the data you've logged, and what needs you next — in one place."
        right={
          <div className="flex gap-2">
            <Link href={link("/evidence")}>
              <Button variant="ghost">Compile review →</Button>
            </Link>
            <Link href={fillHref}>
              <Button size="lg">Track goals →</Button>
            </Link>
          </div>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader label="Reading your goals" />
        </div>
      ) : !hasGoals ? (
        <EmptyState
          title="No goals yet"
          body="Add your performance goals to start tracking them here."
          ctaHref={link("/goals")}
          ctaLabel="Add goals"
        />
      ) : !hasSpecs ? (
        <EmptyState
          title="Goals aren't classified yet"
          body={`You have goals, but none are classified into trackable widgets. Open the analyst (top-right) to classify them${
            unclassifiedGoals.length ? ` — ${unclassifiedGoals.length} waiting` : ""
          }.`}
          ctaHref={link("/goals")}
          ctaLabel="Review goals"
        />
      ) : (
        <Reveal stagger className="flex flex-col gap-6">
          <StatusNarrative summary={summary} queue={queue} />
          <ActionQueue
            queue={queue}
            fillHref={fillHref}
            snapshotHref={link("/snapshots")}
          />
          {unclassifiedGoals.length > 0 ? (
            <UnclassifiedNote count={unclassifiedGoals.length} />
          ) : null}
          <GoalHealthGrid groups={groups} fillHref={fillHref} />
        </Reveal>
      )}
    </main>
  );
}

function EmptyState({ title, body, ctaHref, ctaLabel }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card/40 px-6 py-16 text-center">
      <div
        className="text-[22px] font-semibold uppercase text-fg"
        style={{ fontFamily: "var(--font-dot)", letterSpacing: "0.5px" }}
      >
        {title}
      </div>
      <div className="max-w-[420px] text-[13.5px] leading-[1.5] text-muted-fg">
        {body}
      </div>
      <Link href={ctaHref} className="mt-1">
        <Button>{ctaLabel}</Button>
      </Link>
    </div>
  );
}

function UnclassifiedNote({ count }) {
  return (
    <div
      className="rounded-md border border-border bg-card px-4 py-2.5 text-[11.5px] text-muted-fg"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {count} goal{count === 1 ? "" : "s"} not yet classified — open the analyst
      (top-right) to make {count === 1 ? "it" : "them"} trackable.
    </div>
  );
}

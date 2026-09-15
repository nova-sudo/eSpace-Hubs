"use client";

/**
 * Goal Intelligence Hub — the app's home surface (Dev hub).
 *
 * Three blocks, in the order a person actually needs them:
 *
 *   1. A summary strip — weighted cadence completion against the pacing tick
 *      and the status counts. One row, no charts.
 *   2. The focus block — queue[0] as a full-width hero, the rest of the
 *      attention queue as one-line tinted rows. This is the point of the
 *      page; everything below it is quieter by design.
 *   3. The board as outline bands — every objective a band, every goal a row.
 *      It used to hide behind a "show full board" disclosure; seeing your
 *      whole tree is the page's second job, not an optional extra.
 *
 * Data comes from two shared-domain hooks only (useGoalWidgetItems +
 * useGoalHealth) — no product-surface imports, no integration tiles.
 * `queue` is severity-sorted, so queue[0] IS the top priority.
 */

import Link from "next/link";
import { Button, Card, Label, Loader, Reveal, Section } from "@/components/ui";
import { useGoalWidgetItems } from "@/features/goal-widgets";
import { useHubLink } from "@/features/hubs";
import { ActionQueue } from "./action-queue";
import { FocusSection } from "./focus-section";
import { ObjectiveBands } from "./objective-bands";
import { statusCounts, weightedProgressPercent } from "./progress";
import { SummaryStrip } from "./summary-strip";
import { useGoalHealth } from "./use-goal-health";

export function IntelligencePage() {
  const {
    groupedItems,
    hasGoals,
    hasSpecs,
    unclassifiedGoals,
    ready: itemsReady,
    goalsError,
    retryGoals,
  } = useGoalWidgetItems();
  const { ready: inputsReady, groups, queue, summary } = useGoalHealth(groupedItems);

  const link = useHubLink();
  const fillHref = link("/goals");
  const snapshotHref = link("/snapshots");

  const loading = !itemsReady || !inputsReady;
  const needCount = queue?.length ?? 0;
  const crumb =
    hasSpecs && !loading ? `Start here · ${needCount} of ${summary.total} need you` : "Goal intelligence";

  const counts = statusCounts(groups, unclassifiedGoals.length);
  const progress = weightedProgressPercent(groups);

  return (
    <main className="relative z-[2] mx-auto max-w-[1040px] px-4 pb-16 pt-7 sm:px-10">
      <div className="mb-7">
        <Label>{crumb}</Label>
        <h1 className="mt-3.5 text-[40px] font-extrabold leading-[1.05] tracking-[-0.03em] text-fg">
          One thing at a time.
        </h1>
      </div>

      {goalsError && !itemsReady ? (
        // A failed /goals fetch settles once (no auto-retry loop) — give
        // the user the error and a way back instead of an endless spinner.
        <Card padding={40} className="flex flex-col items-center gap-4 text-center">
          <div className="text-[15px] font-bold text-fg">Couldn&apos;t load your goals</div>
          <p className="max-w-[42ch] text-[13px] leading-[1.5] text-muted-fg">
            {goalsError.message || "The server didn't respond. Check your connection and try again."}
          </p>
          <Button onClick={() => void retryGoals()}>Retry</Button>
        </Card>
      ) : loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader label="Reading your goals" />
        </div>
      ) : !hasGoals ? (
        <EmptyState
          title="No goals yet"
          body="Add your performance goals to start tracking them here."
          ctaHref={fillHref}
          ctaLabel="Add goals"
        />
      ) : !hasSpecs ? (
        <EmptyState
          title="Goals aren't classified yet"
          body={`You have goals, but none are classified into trackable widgets. Open the analyst (top-right) to classify them${
            unclassifiedGoals.length ? ` — ${unclassifiedGoals.length} waiting` : ""
          }.`}
          ctaHref={fillHref}
          ctaLabel="Review goals"
        />
      ) : (
        <Reveal stagger>
          <SummaryStrip percent={progress} counts={counts} className="mb-7" />

          <Section
            title={needCount > 0 ? "Needs you first" : "Where you stand"}
            right={
              needCount > 1 ? (
                <span className="text-[13px] text-muted-fg">{needCount} waiting</span>
              ) : null
            }
          >
            <FocusSection queue={queue} fillHref={fillHref} total={summary.total} />
            <div className="mt-2.5">
              <ActionQueue snapshotHref={snapshotHref} />
            </div>
          </Section>

          <Section
            title="All objectives"
            right={
              <span className="text-[13px] text-muted-fg">
                {summary.total} goal{summary.total === 1 ? "" : "s"} · {counts.onPace} on pace
              </span>
            }
          >
            <ObjectiveBands groups={groups} />
            {unclassifiedGoals.length > 0 ? (
              <UnclassifiedNote count={unclassifiedGoals.length} />
            ) : null}
          </Section>
        </Reveal>
      )}
    </main>
  );
}

function EmptyState({ title, body, ctaHref, ctaLabel }) {
  return (
    <Card padding={40} className="flex flex-col items-center gap-3 text-center">
      <div className="text-[15px] font-bold text-fg">{title}</div>
      <div className="max-w-[420px] text-[13px] leading-[1.5] text-muted-fg">{body}</div>
      <Link href={ctaHref} className="mt-1">
        <Button>{ctaLabel}</Button>
      </Link>
    </Card>
  );
}

function UnclassifiedNote({ count }) {
  return (
    <Card padding={16} className="mt-2.5 text-[13px] text-muted-fg">
      {count} goal{count === 1 ? "" : "s"} not yet classified — open the analyst (top-right) to make{" "}
      {count === 1 ? "it" : "them"} trackable.
    </Card>
  );
}

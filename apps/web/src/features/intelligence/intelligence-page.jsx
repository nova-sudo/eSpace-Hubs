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

import { useRouter } from "next/navigation";
import { DrillDownNav } from "@/components/shell/drill-down-nav";
import { Button, Card, Label, Loader, Reveal, Section } from "@/components/ui";
import { useAnalystOptional, ANALYST_MODES } from "@/features/analyst";
import { fetchSpecs, getSpecsState } from "@/features/goal-specs";
import { useGoalWidgetItems } from "@/features/goal-widgets";
import { useHubLink } from "@/features/hubs";
import { ActionQueue } from "./action-queue";
import { FocusSection } from "./focus-section";
import { ManagerNotesCard } from "./manager-notes-card";
import { ObjectiveBands } from "./objective-bands";
import {
  loggedCheckIns,
  statusCounts,
  unmeasuredCount,
  weightedProgressPercent,
} from "./progress";
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
  const {
    ready: inputsReady,
    error: inputsError,
    retry: retryInputs,
    groups,
    queue,
    summary,
  } = useGoalHealth(groupedItems);
  // useGoalWidgetItems subscribes to the specs store, so this read is fresh
  // on every render; `fetched` stays false after a failed GET, and the
  // page would otherwise sit on "Reading your goals" for good.
  const specsState = getSpecsState();
  const specsError = specsState.fetched ? null : specsState.error;

  const link = useHubLink();
  const router = useRouter();
  const analyst = useAnalystOptional();
  const goalsEditorHref = link("/settings?tab=goals");
  const snapshotHref = link("/snapshots");
  const openAnalyst = analyst
    ? () => analyst.requestOpen(ANALYST_MODES.ANALYSIS)
    : () => router.push(goalsEditorHref);

  const loading = !itemsReady || !inputsReady;
  // Whichever of the three loads failed first: same card, its own Retry.
  const loadError = goalsError && !itemsReady
    ? { error: goalsError, retry: retryGoals }
    : specsError
      ? { error: specsError, retry: fetchSpecs }
      : inputsError
        ? { error: inputsError, retry: retryInputs }
        : null;
  const needCount = queue?.length ?? 0;
  const crumb =
    hasSpecs && !loading ? `Start here · ${needCount} of ${summary.total} need you` : "Goal intelligence";

  const counts = statusCounts(groups, unclassifiedGoals.length);
  const progress = weightedProgressPercent(groups);
  const logged = loggedCheckIns(groups);
  const unmeasured = unmeasuredCount(groups, unclassifiedGoals.length);
  // Same bucket the badges call "on pace" (+ exceeding) — auto-tracked goals
  // have their own badge and aren't folded in any more.
  const onPaceCount = summary.onPace;

  return (
    <main className="relative z-[2] mx-auto max-w-[1040px] px-4 pb-16 pt-7 sm:px-10">
      <div className="mb-5">
        <Label>{crumb}</Label>
        <h1 className="mt-3.5 text-[40px] font-extrabold leading-[1.05] tracking-[-0.03em] text-fg">
          One thing at a time.
        </h1>
      </div>
      {/* Overview · Reviews log · Snapshots (· Shared with me) — the home
          tab's drill-downs. Self-hides on hubs without any. */}
      <DrillDownNav className="mb-7" />

      {loadError ? (
        // A failed /goals, /goal-specs or /goal-inputs fetch settles once (no
        // auto-retry loop) — give the user the error and a way back instead
        // of an endless spinner.
        <Card padding={40} className="flex flex-col items-center gap-4 text-center">
          <div className="text-[15px] font-bold text-fg">Couldn&apos;t load your goals</div>
          <p className="max-w-[42ch] text-[13px] leading-[1.5] text-muted-fg">
            {loadError.error?.message || "The server didn't respond. Check your connection and try again."}
          </p>
          <Button onClick={() => void loadError.retry()}>Retry</Button>
        </Card>
      ) : loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader label="Reading your goals" />
        </div>
      ) : !hasGoals ? (
        // The Goals page is empty too when there are no goals — send the
        // user to the editor / importer in Settings instead.
        <EmptyState
          title="No goals yet"
          body="Add your performance goals — or import them from your review document — to start tracking them here."
          ctaLabel="Add or import goals"
          onCta={() => router.push(goalsEditorHref)}
        />
      ) : !hasSpecs ? (
        <EmptyState
          title="Goals aren't set up for tracking yet"
          body={`You have goals, but none has a tracker yet. The analyst reads each goal and picks how to measure it${
            unclassifiedGoals.length ? ` — ${unclassifiedGoals.length} waiting` : ""
          }.`}
          ctaLabel="Analyze my goals"
          onCta={openAnalyst}
        />
      ) : (
        <Reveal stagger>
          {/* data-section-id: targets for the 1–9 / j / k section jumps and
              the palette's "Jump to section" entries (commands.js). */}
          <div data-section-id="sec-summary">
            <SummaryStrip
              percent={progress}
              logged={logged}
              counts={counts}
              unmeasured={unmeasured}
              className="mb-7"
            />
          </div>

          <div data-section-id="sec-focus">
            <Section
              title={needCount > 0 ? "Needs you first" : "Where you stand"}
              right={
                needCount > 1 ? (
                  <span className="text-[13px] text-muted-fg">{needCount} waiting</span>
                ) : null
              }
            >
              <FocusSection queue={queue} total={summary.total} />
              <div className="mt-2.5">
                <ActionQueue snapshotHref={snapshotHref} />
              </div>
              <ManagerNotesCard className="mt-2.5" />
            </Section>
          </div>

          <div data-section-id="sec-objectives">
            <Section
              title="All objectives"
              right={
                <span className="text-[13px] text-muted-fg">
                  {summary.total} goal{summary.total === 1 ? "" : "s"} · {onPaceCount} on pace
                </span>
              }
            >
              <ObjectiveBands groups={groups} />
              {unclassifiedGoals.length > 0 ? (
                <UnclassifiedNote count={unclassifiedGoals.length} onAnalyze={openAnalyst} />
              ) : null}
            </Section>
          </div>
        </Reveal>
      )}
    </main>
  );
}

/** A Button that navigates via onClick — no <a><button/></a> nesting. */
function EmptyState({ title, body, ctaLabel, onCta }) {
  return (
    <Card padding={40} className="flex flex-col items-center gap-3 text-center">
      <div className="text-[15px] font-bold text-fg">{title}</div>
      <div className="max-w-[420px] text-[13px] leading-[1.5] text-muted-fg">{body}</div>
      <Button className="mt-1" onClick={onCta}>
        {ctaLabel}
      </Button>
    </Card>
  );
}

function UnclassifiedNote({ count, onAnalyze }) {
  return (
    <Card padding={16} className="mt-2.5 flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted-fg">
      <span>
        {count} goal{count === 1 ? "" : "s"} without a tracker yet — the analyst picks how to measure{" "}
        {count === 1 ? "it" : "them"}.
      </span>
      <Button variant="soft" size="sm" onClick={onAnalyze}>
        Analyze my goals
      </Button>
    </Card>
  );
}

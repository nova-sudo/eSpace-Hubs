"use client";

/**
 * Goal Intelligence Hub — the app's home surface (Dev hub), "Focus" layout.
 *
 * One thing at a time. Instead of a wall of health cards, the page leads with
 * a single hero for the most-slipping goal (queue[0]), a short "also needs
 * you" list (queue[1..3]) and a snapshot nudge beside it, and the full health
 * board tucked behind a disclosure. When nothing needs the user, a calm
 * "all caught up" card.
 *
 * Data comes from two shared-domain hooks only (useGoalWidgetItems +
 * useGoalHealth) — no product-surface imports, no integration tiles.
 * `queue` is severity-sorted, so queue[0] IS the top priority.
 */

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge, Button, Card, Label, Loader, Reveal } from "@/components/ui";
import { readinessLabel, useGoalWidgetItems } from "@/features/goal-widgets";
import { useHubLink } from "@/features/hubs";
import { specCadence } from "@/features/goal-specs";
import { cadenceWindowLabel } from "@/features/goal-inputs";
import { cn } from "@/lib/cn";
import { ActionQueue } from "./action-queue";
import { FocusCarousel } from "./focus-carousel";
import { GoalHealthGrid } from "./goal-health-grid";
import { HEALTH } from "./status";
import { useGoalHealth } from "./use-goal-health";

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

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
  const [showBoard, setShowBoard] = useState(false);

  const loading = !itemsReady || !inputsReady;
  const needCount = queue?.length ?? 0;
  const crumb =
    hasSpecs && !loading ? `Start here · ${needCount} of ${summary.total} need you` : "Goal intelligence";

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
        <Reveal stagger className="flex flex-col gap-4">
          {needCount > 0 ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <FocusCarousel queue={queue} />
              </div>
              <div className="flex flex-col gap-4">
                {queue.length > 1 ? <AlsoNeedsYou items={queue.slice(1, 4)} fillHref={fillHref} /> : null}
                <ActionQueue snapshotHref={snapshotHref} />
              </div>
            </div>
          ) : (
            <AllCaughtUp total={summary.total} />
          )}

          {unclassifiedGoals.length > 0 ? <UnclassifiedNote count={unclassifiedGoals.length} /> : null}

          {/* Full health board — tucked away so the page stays calm. */}
          <div>
            <Button variant="soft" size="sm" onClick={() => setShowBoard((v) => !v)}>
              {showBoard ? "Hide" : `Show full board · ${summary.total} goals`}
            </Button>
            {showBoard ? (
              <div className="mt-4">
                <GoalHealthGrid groups={groups} fillHref={fillHref} />
              </div>
            ) : null}
          </div>
        </Reveal>
      )}
    </main>
  );
}

/** Which tint a queue item reads as in "Also needs you" — lemon for
 *  not-logged/needs-setup, peach for behind/overdue/stale. */
function alsoNeedsYouTone(health) {
  if (health?.overdue) return "peach";
  if (health?.status === HEALTH.BEHIND || health?.status === HEALTH.STALE) return "peach";
  return "lemon";
}

/** One-line status text for an "Also needs you" row, in the goal's own
 *  cadence terms. */
function alsoNeedsYouLine(card) {
  const { health, spec } = card;
  if (health?.status === HEALTH.NEEDS_SETUP) {
    return readinessLabel(health.readiness) || "Needs setup";
  }
  const cadence = specCadence(spec);
  if (health?.status === HEALTH.NO_DATA) {
    return cadence ? `Not logged yet · ${capitalize(cadence)}` : "Not logged yet";
  }
  if (health?.status === HEALTH.STALE) {
    const [singular, plural] = cadenceWindowLabel(cadence);
    const missed = health.missedWindows || 1;
    return `Gone quiet · ${missed} ${missed === 1 ? singular : plural}`;
  }
  if (health?.status === HEALTH.BEHIND) return "Behind target";
  return "Needs attention";
}

/** The short list beside the hero — queue[1..3], each a tinted row linking
 *  back to Goals (where the fuller fill/edit UI lives). */
function AlsoNeedsYou({ items, fillHref }) {
  return (
    <Card padding={22} className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between">
        <div className="text-[15px] font-bold text-fg">Also needs you</div>
        <Badge>{items.length}</Badge>
      </div>
      <div className="flex flex-col gap-2.5">
        {items.map((card) => (
          <Link
            key={card.goal.id}
            href={fillHref}
            className={cn(
              "flex flex-col gap-2 rounded-[var(--radius-lg)] p-3.5",
              alsoNeedsYouTone(card.health) === "peach" ? "bg-peach text-peach-ink" : "bg-lemon text-lemon-ink",
            )}
          >
            <div className="text-[14px] font-bold leading-[1.3]">{card.goal.title}</div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold opacity-80">{alsoNeedsYouLine(card)}</span>
              <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-ink text-ink-on">
                <ChevronRight size={13} />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </Card>
  );
}

/** Shown when the attention queue is empty — everything's on pace. */
function AllCaughtUp({ total }) {
  return (
    <Card tone="mint" padding={30} className="text-center">
      <div className="text-[22px] font-extrabold tracking-[-0.02em] text-mint-ink">All caught up.</div>
      <div className="mx-auto mt-2 max-w-[380px] text-[13.5px] leading-[1.5] text-mint-ink/80">
        Every one of your {total} goals has reached Achieved or better. Nothing needs you right now.
      </div>
    </Card>
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
    <Card padding={16} className="text-[13px] text-muted-fg">
      {count} goal{count === 1 ? "" : "s"} not yet classified — open the analyst (top-right) to make{" "}
      {count === 1 ? "it" : "them"} trackable.
    </Card>
  );
}

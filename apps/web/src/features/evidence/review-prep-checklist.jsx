"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { hasSnapshotThisWeek, useSnapshots } from "@/features/snapshots";
import { useGoalWidgetItems } from "@/features/goal-widgets";
import { useActiveHub, useHubLink } from "@/features/hubs";

/**
 * Review-prep checklist — the pre-flight steps before generating evidence:
 *
 *   1. Classify your goals into trackers
 *   2. Capture a snapshot this week (hubs that expose the slot)
 *
 * All steps derive from real app state — no independent checkboxes.
 * Sits inside the "Review packet" sidebar card on the Evidence page.
 *
 * Deliberately GOAL-oriented: earlier versions gated on "connect a
 * code host" and "connect Jira" — integrations this page stopped
 * consuming when it went goals-only — so the first thing users saw was
 * a blocker demanding setup the document never used.
 */
export function ReviewPrepChecklist() {
  const { items, unclassifiedGoals } = useGoalWidgetItems();
  // L2s are the goals that get trackers; L1s are section headers.
  const trackedCount = items.filter((it) => it.goal?.kind !== "L1").length;
  const totalGoals = trackedCount + (unclassifiedGoals?.length || 0);
  const { snapshots } = useSnapshots();
  const hub = useActiveHub();
  const link = useHubLink();

  // One predicate with the Home nudge: the snapshot's WEEK key, never the
  // day it was written (the scheduler's Sunday freeze of last week used to
  // turn this green while Home still asked for this week's).
  const hasThisWeekSnap = hasSnapshotThisWeek(snapshots);
  const untracked = Math.max(0, totalGoals - trackedCount);

  const steps = [
    {
      id: "classified",
      // Say the state, not the goal: "10 of 13 goals have no tracker yet"
      // on peach read as done when it said "All goals have a tracker (3 of 13)".
      label:
        totalGoals > 0 && untracked === 0
          ? `All ${totalGoals} goal${totalGoals === 1 ? " has" : "s have"} a tracker`
          : `${untracked} of ${totalGoals} goal${totalGoals === 1 ? "" : "s"} ${untracked === 1 ? "has" : "have"} no tracker yet`,
      // Ticks only when EVERY goal is classified — one tracked goal out
      // of ten used to read as done.
      done: totalGoals > 0 && trackedCount === totalGoals,
      href: link("/goals"),
      actionLabel: "Classify",
    },
  ];
  // Only hubs that actually expose the snapshots slot get the step —
  // linking a QA user to a page the slot guard bounces them off of is a
  // checklist that can never reach ready.
  if (hub?.pages?.snapshots) {
    steps.push({
      id: "snapshot",
      label: "Snapshot captured this week",
      done: Boolean(hasThisWeekSnap),
      href: link("/snapshots"),
      actionLabel: "Capture",
    });
  }

  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Review prep checklist">
      {steps.map((step) => (
        <ChecklistRow key={step.id} step={step} />
      ))}
    </div>
  );
}

/** One checklist row: mint + check when done, lemon (pending) + hollow circle + a link when open. */
function ChecklistRow({ step }) {
  if (step.done) {
    return (
      <div className="flex items-center gap-2.5 rounded-[var(--radius-lg)] bg-mint px-3 py-2.5 text-mint-ink">
        <Check size={14} strokeWidth={2.5} className="shrink-0" />
        <span className="flex-1 text-[13px] font-semibold">{step.label}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5 rounded-[var(--radius-lg)] bg-lemon px-3 py-2.5 text-lemon-ink">
      <span
        aria-hidden="true"
        className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-current"
      />
      <span className="flex-1 text-[13px] font-semibold">{step.label}</span>
      <Link href={step.href} className="link-target text-[12px] font-bold text-inherit">
        {step.actionLabel}
      </Link>
    </div>
  );
}


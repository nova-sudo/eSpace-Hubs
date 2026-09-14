"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { useSnapshots } from "@/features/snapshots";
import { useGoalWidgetItems } from "@/features/goal-widgets";
import { useActiveHub, useHubLink } from "@/features/hubs";
import { weekLabel } from "@/lib/date";

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
  const { hasSpecs } = useGoalWidgetItems();
  const { snapshots } = useSnapshots();
  const hub = useActiveHub();
  const link = useHubLink();

  // Snapshot weeks are stamped with lib/date's weekLabel ("Wnn") — use
  // the same function here so the comparison can actually match, with
  // capturedAt-this-week as the tolerant fallback.
  const currentWeek = weekLabel(new Date());
  const latestSnap = snapshots[0];
  const hasThisWeekSnap =
    latestSnap?.week === currentWeek ||
    (latestSnap?.capturedAt &&
      new Date(latestSnap.capturedAt) >= startOfWeek(new Date()));

  const steps = [
    {
      id: "classified",
      label: "Every goal has a grade",
      done: hasSpecs,
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

/** One checklist row: mint + check when done, peach + hollow circle + a link when open. */
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
    <div className="flex items-center gap-2.5 rounded-[var(--radius-lg)] bg-peach px-3 py-2.5 text-peach-ink">
      <span
        aria-hidden="true"
        className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-current"
      />
      <span className="flex-1 text-[13px] font-semibold">{step.label}</span>
      <Link href={step.href} className="text-[12px] font-bold text-inherit">
        {step.actionLabel}
      </Link>
    </div>
  );
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

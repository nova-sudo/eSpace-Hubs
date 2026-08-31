"use client";

import Link from "next/link";
import { useSnapshots } from "@/features/snapshots";
import { useGoalWidgetItems } from "@/features/goal-widgets";
import { useActiveHub, useHubLink } from "@/features/hubs";
import { weekLabel } from "@/lib/date";

/**
 * Review-prep checklist — a compact horizontal strip showing the
 * pre-flight steps before generating evidence:
 *
 *   1. Classify your goals into trackers
 *   2. Capture a snapshot this week (hubs that expose the slot)
 *   3. → Generate evidence
 *
 * All steps derive from real app state — no independent checkboxes.
 * Sits at the top of the Evidence page.
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
      label: "Goals classified",
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
      label: "Snapshot",
      done: Boolean(hasThisWeekSnap),
      href: link("/snapshots"),
      actionLabel: "Capture",
    });
  }

  // The generate step is the last window in the fill-strip: lit only once
  // the prerequisites are met.
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = steps.every((s) => s.done);
  const total = steps.length + 1;
  const ready = doneCount + (allDone ? 1 : 0);

  return (
    <div
      className="flex items-center gap-3.5 rounded-[var(--radius-tile)] border border-dashed border-border-strong px-4 py-3"
      style={{ background: "var(--panel)" }}
      role="status"
      aria-label="Review prep checklist"
    >
      <span
        className="shrink-0 uppercase tracking-[1.5px] text-muted-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
      >
        Review prep
      </span>

      <div className="flex flex-1 items-center gap-1.5">
        {steps.map((step) => (
          <SegmentLink key={step.id} step={step} />
        ))}
        <Link
          href={link("/evidence")}
          aria-label="Generate evidence"
          title={allDone ? "Generate evidence" : "Finish the prep steps first"}
          className="h-[5px] flex-1 rounded-full transition-colors"
          style={{
            background: allDone ? "var(--accent)" : "var(--dot-dim)",
          }}
        />
      </div>

      <span
        className="shrink-0 tracking-[1px]"
        style={{
          fontFamily: "var(--font-dot)",
          fontWeight: 700,
          fontSize: 14,
          color: "var(--accent)",
        }}
      >
        {ready}/{total} ready
      </span>
    </div>
  );
}

/**
 * One window in the prep fill-strip. Filled (good) when the step is done;
 * otherwise a faint track that links to the action that completes it.
 */
function SegmentLink({ step }) {
  const seg = (
    <span
      className="block h-[5px] w-full rounded-full transition-colors"
      style={{ background: step.done ? "var(--good)" : "var(--dot-dim)" }}
    />
  );
  if (step.done) {
    return (
      <span className="flex-1" title={step.label} aria-label={`${step.label} ready`}>
        {seg}
      </span>
    );
  }
  return (
    <Link
      href={step.href}
      className="flex-1"
      title={`${step.label} — ${step.actionLabel}`}
      aria-label={`${step.label}: ${step.actionLabel}`}
    >
      {seg}
    </Link>
  );
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

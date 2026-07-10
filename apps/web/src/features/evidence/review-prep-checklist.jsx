"use client";

import Link from "next/link";
import { useIntegrations } from "@/features/integrations";
import { useSnapshots } from "@/features/snapshots";
import { useHubLink } from "@/features/hubs";

/**
 * Review-prep checklist — a compact horizontal strip showing the
 * four pre-flight steps before generating evidence:
 *
 *   1. Connect a code host (GitLab or GitHub)
 *   2. Connect Jira
 *   3. Capture a snapshot this week
 *   4. → Generate evidence
 *
 * All steps are derived from real app state — no independent checkboxes.
 * Sits at the top of the Evidence page.
 */
export function ReviewPrepChecklist() {
  const { isConnected } = useIntegrations();
  const { snapshots } = useSnapshots();
  const link = useHubLink();

  const hasCodeHost = isConnected("gitlab") || isConnected("github");
  const hasJira = isConnected("jira");

  const currentWeek = isoWeekLabel(new Date());
  const latestSnap = snapshots[0];
  const hasThisWeekSnap =
    latestSnap?.week === currentWeek ||
    (latestSnap?.capturedAt &&
      new Date(latestSnap.capturedAt) >= startOfWeek(new Date()));

  const steps = [
    {
      id: "code-host",
      label: hasCodeHost ? "Code host" : "Code host",
      done: hasCodeHost,
      href: link("/settings"),
      actionLabel: "Connect",
    },
    {
      id: "jira",
      label: "Jira",
      done: hasJira,
      href: link("/settings"),
      actionLabel: "Connect",
    },
    {
      id: "snapshot",
      label: "Snapshot",
      done: hasThisWeekSnap,
      href: link("/snapshots"),
      actionLabel: "Capture",
    },
  ];

  // The generate step is the 4th window in the fill-strip: lit only once the
  // three prerequisites are met.
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

function isoWeekLabel(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `W${String(weekNo).padStart(2, "0")}-${d.getUTCFullYear()}`;
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

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
 * Sits at the top of the Evidence page and the compact dashboard.
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

  const allDone = steps.every((s) => s.done);

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-[var(--radius-tile)] border border-border bg-card-alt px-4 py-3"
      role="status"
      aria-label="Review prep checklist"
    >
      <span
        className="shrink-0 uppercase tracking-[0.4px] text-muted-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
      >
        Review prep
      </span>
      <span className="h-3 w-px bg-border" aria-hidden="true" />
      {steps.map((step) => (
        <CheckStep key={step.id} step={step} />
      ))}
      <span className="h-3 w-px bg-border" aria-hidden="true" />
      <Link
        href={link("/evidence")}
        className="inline-flex items-center gap-1 rounded-[var(--radius-sub)] border border-border bg-card px-2.5 py-1 transition-colors hover:border-border-strong"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.35px" }}
      >
        {allDone ? (
          <span className="text-accent font-bold">→ Generate evidence</span>
        ) : (
          <span className="text-muted-fg">Generate evidence</span>
        )}
      </Link>
    </div>
  );
}

function CheckStep({ step }) {
  const dot = step.done ? (
    <span style={{ color: "var(--good)" }}>✓</span>
  ) : (
    <span style={{ color: "var(--muted-fg)" }}>○</span>
  );

  return (
    <span
      className="flex items-center gap-1"
      style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
    >
      {dot}
      {step.done ? (
        <span className="text-fg">{step.label}</span>
      ) : (
        <Link
          href={step.href}
          className="text-accent underline-offset-2 hover:underline"
        >
          {step.label}
        </Link>
      )}
    </span>
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

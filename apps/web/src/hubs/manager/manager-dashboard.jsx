"use client";

/**
 * Manager Hub — Team overview. Renders at /manager.
 *
 * The manager's landing surface: direct reports (users whose `managerId`
 * is this manager), with a team-wide goal-tracking rollup and a per-row
 * "needs attention" signal so a manager can tell who to look at without
 * opening every board. "Needs attention" = goals that are ready to track
 * but have no data yet, or still need context before they can start —
 * see useTeamGoalSummary.
 *
 * Data: GET /api/v1/manager/reports, fanned out per-report to
 * GET /api/v1/manager/reports/:id/goal-health for the rollup.
 */

import Link from "next/link";
import { MonoLabel, PageHeader, Pill } from "@/components/ui";
import { useActiveHubStrict, useHubLink } from "@/features/hubs";
import { useManagerReports } from "./use-manager-reports";
import { useDelegatedQueue } from "./use-delegated-queue";
import { useApprovalsQueue } from "./use-approvals-queue";
import { useTeamGoalSummary } from "./use-team-goal-summary";

function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function ManagerDashboard() {
  const hub = useActiveHubStrict();
  const link = useHubLink();
  const { loading, reports, error } = useManagerReports();
  const { items: delegated, loading: delLoading } = useDelegatedQueue();
  const { items: approvals, loading: apprLoading } = useApprovalsQueue();
  const { loading: summaryLoading, totals, perReport } = useTeamGoalSummary(reports);
  const pendingDelegated = delegated.filter((d) => !d.verdict).length;
  const awaiting = pendingDelegated + approvals.length;
  const awaitingLoading = delLoading || apprLoading;
  const reportsNeedingAttention = Array.from(perReport.values()).filter(
    (s) => s.needsAttention > 0,
  ).length;

  return (
    <main className="relative z-[2] mx-auto max-w-5xl px-4 sm:px-10 pb-14 pt-9">
      <PageHeader
        crumb={`${hub.label} · team`}
        title="Your team, at a glance."
        italicWord="glance"
        subtitle="Your direct reports and where they stand — goal tracking, delegated goals, and grading, all in one view."
      />

      <div className="mt-2 grid grid-cols-4 gap-4">
        <StatCard
          label="Direct reports"
          value={loading ? "—" : String(reports.length)}
          sub={
            loading ? "loading" : reports.length ? "assigned to you" : "none yet"
          }
        />
        <StatCard
          label="Goals tracked"
          value={loading || summaryLoading ? "—" : String(totals.goals)}
          sub={
            loading || summaryLoading
              ? "loading"
              : `${totals.graded} graded across the team`
          }
        />
        <StatCard
          label="Needs attention"
          value={loading || summaryLoading ? "—" : String(reportsNeedingAttention)}
          tone={reportsNeedingAttention ? "warn" : null}
          sub={
            loading || summaryLoading
              ? "loading"
              : reportsNeedingAttention
                ? "reports with unset-up or no-data goals"
                : "everyone's set up"
          }
        />
        <StatCard
          label="Awaiting your call"
          value={awaitingLoading ? "—" : String(awaiting)}
          tone={awaiting ? "accent" : null}
          sub={
            awaitingLoading
              ? "loading"
              : awaiting
                ? `${pendingDelegated} delegated · ${approvals.length} approvals`
                : "nothing pending"
          }
        />
      </div>

      <div className="mt-10">
        <MonoLabel>Roster</MonoLabel>
        <div className="mt-3">
          {error ? (
            <EmptyCard>
              Couldn't load your team right now. Refresh, or check back in a
              moment.
            </EmptyCard>
          ) : loading ? (
            <EmptyCard>Loading your team…</EmptyCard>
          ) : reports.length === 0 ? (
            <EmptyCard>
              No direct reports are assigned to you yet. An admin sets each
              engineer's manager under{" "}
              <span className="text-fg">User management</span> — once that's in
              place, your team shows up here.
            </EmptyCard>
          ) : (
            <ul className="grid gap-2">
              {reports.map((r) => (
                <li key={r.id}>
                  <Link
                    href={link(`/employees/${r.id}`)}
                    className="flex items-center gap-4 rounded-md border border-border bg-card px-4 py-3 transition-colors hover:bg-accent-dim/40"
                  >
                    <span
                      className="grid h-10 w-10 flex-none place-items-center rounded-full bg-panel-2 text-muted-fg"
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontWeight: 700,
                        fontSize: 12,
                      }}
                    >
                      {initials(r.displayName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-semibold">
                        {r.displayName}
                      </div>
                      <div
                        className="mt-0.5 truncate text-muted-fg"
                        style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
                      >
                        {[r.role, r.department, r.level]
                          .filter(Boolean)
                          .join(" · ") || r.email}
                      </div>
                    </div>
                    {perReport.get(r.id)?.needsAttention > 0 ? (
                      <Pill tone="warn">
                        {perReport.get(r.id).needsAttention} need attention
                      </Pill>
                    ) : null}
                    <span
                      className="text-accent"
                      style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
                    >
                      View board →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}

const STAT_TONE = {
  warn: "var(--warn)",
  accent: "var(--accent)",
};

function StatCard({ label, value, sub, tone }) {
  const color = tone ? STAT_TONE[tone] : null;
  return (
    <div
      className="rounded-md border border-border bg-card p-5"
      style={{ borderColor: color ? color : "var(--border-strong)" }}
    >
      <div
        className="uppercase tracking-[0.4px] text-muted-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
      >
        {label}
      </div>
      <div
        className="mt-2"
        style={{
          fontFamily: "var(--font-dot)",
          fontWeight: 900,
          fontSize: 34,
          letterSpacing: "0.5px",
          lineHeight: 1.05,
          color: color || "var(--fg)",
        }}
      >
        {value}
      </div>
      <div
        className="mt-1 text-[12px] text-muted-fg"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {sub}
      </div>
    </div>
  );
}

function EmptyCard({ children }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-card p-6 text-[13px] leading-[1.6] text-muted-fg">
      {children}
    </div>
  );
}

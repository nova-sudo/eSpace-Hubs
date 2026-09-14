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
import { ArrowRight } from "lucide-react";
import { Badge, Label, PageHeader, Stat } from "@/components/ui";
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
    <main className="max-w-[1280px] mx-auto px-4 sm:px-10 pb-16 pt-7">
      <PageHeader
        crumb={`${hub.label} · team`}
        title="Your team, at a glance."
        subtitle="Your direct reports and where they stand — goal tracking, delegated goals, and grading, all in one view."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-[var(--radius-xl)] bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
          <Stat
            label="Direct reports"
            value={loading ? "—" : String(reports.length)}
            sub={loading ? "loading" : reports.length ? "assigned to you" : "none yet"}
          />
        </div>
        <div className="rounded-[var(--radius-xl)] bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
          <Stat
            label="Goals tracked"
            value={loading || summaryLoading ? "—" : String(totals.goals)}
            sub={
              loading || summaryLoading
                ? "loading"
                : `${totals.graded} graded across the team`
            }
          />
        </div>
        <div className="rounded-[var(--radius-xl)] bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
          <Stat
            label="Needs attention"
            value={loading || summaryLoading ? "—" : String(reportsNeedingAttention)}
            sub={
              loading || summaryLoading
                ? "loading"
                : reportsNeedingAttention
                  ? "reports with unset-up or no-data goals"
                  : "everyone's set up"
            }
          />
        </div>
        <div className="rounded-[var(--radius-xl)] bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
          <Stat
            label="Awaiting your call"
            value={awaitingLoading ? "—" : String(awaiting)}
            sub={
              awaitingLoading
                ? "loading"
                : awaiting
                  ? `${pendingDelegated} delegated · ${approvals.length} approvals`
                  : "nothing pending"
            }
          />
        </div>
      </div>

      <div className="mt-9">
        <Label>Roster</Label>
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
              <span className="text-fg font-bold">User management</span> — once
              that's in place, your team shows up here.
            </EmptyCard>
          ) : (
            <ul className="grid gap-2">
              {reports.map((r) => (
                <li key={r.id}>
                  <Link
                    href={link(`/employees/${r.id}`)}
                    className="flex items-center gap-4 rounded-[var(--radius-xl)] bg-card px-4 py-3.5 transition-colors hover:bg-card-alt"
                    style={{ boxShadow: "var(--shadow-card)" }}
                  >
                    <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-lav text-lav-ink text-[12px] font-bold">
                      {initials(r.displayName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14.5px] font-bold">{r.displayName}</div>
                      <div className="mt-0.5 truncate text-[12px] text-muted-fg">
                        {[r.role, r.department, r.level].filter(Boolean).join(" · ") ||
                          r.email}
                      </div>
                    </div>
                    {perReport.get(r.id)?.needsAttention > 0 ? (
                      <Badge tone="lemon">
                        {perReport.get(r.id).needsAttention} need attention
                      </Badge>
                    ) : null}
                    <span className="flex items-center gap-1 text-[12.5px] font-bold text-fg">
                      View board <ArrowRight size={13} />
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

function EmptyCard({ children }) {
  return (
    <div
      className="rounded-[var(--radius-xl)] bg-card p-6 text-[13px] leading-[1.6] text-muted-fg"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      {children}
    </div>
  );
}

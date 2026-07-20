"use client";

/**
 * Manager Hub — Team overview. Renders at /manager.
 *
 * The manager's landing surface: their direct reports (users whose
 * `managerId` is this manager) as a light roster. Per-report goal
 * boards, tier grading, delegated-goal verdicts, and Build-Your-Own
 * approvals land across P1–P4 (docs/manager-hub-plan.md). This P0 view
 * proves the vertical slice — capability gate → managerId-scoped read →
 * warm-white/orange themed UI.
 *
 * Data: GET /api/v1/manager/reports.
 */

import { MonoLabel, PageHeader } from "@/components/ui";
import { useActiveHubStrict } from "@/features/hubs";
import { useManagerReports } from "./use-manager-reports";

function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function ManagerDashboard() {
  const hub = useActiveHubStrict();
  const { loading, reports, error } = useManagerReports();

  return (
    <main className="relative z-[2] mx-auto max-w-5xl px-10 pb-14 pt-9">
      <PageHeader
        crumb={`${hub.label} · team`}
        title="Your team, at a glance."
        italicWord="glance"
        subtitle="Your direct reports and where they stand. Goal health, delegated goals, and grading arrive in the next drops."
      />

      <div className="mt-2 grid grid-cols-3 gap-4">
        <StatCard
          label="Direct reports"
          value={loading ? "—" : String(reports.length)}
          sub={
            loading ? "loading" : reports.length ? "assigned to you" : "none yet"
          }
        />
        <StatCard label="Goals tracked" value="—" sub="lands with goal health" />
        <StatCard
          label="Awaiting your call"
          value="—"
          sub="grading + approvals next"
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
                <li
                  key={r.id}
                  className="flex items-center gap-4 rounded-md border border-border bg-card px-4 py-3"
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
                  <span
                    className="rounded-full border border-dashed border-border px-2.5 py-1 text-dim-fg"
                    style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
                  >
                    board soon
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="mt-8 text-[12.5px] leading-[1.6] text-muted-fg">
        Next: per-report goal boards, tier grading, delegated-goal verdicts, and
        Build-Your-Own approvals — see{" "}
        <span className="text-fg">docs/manager-hub-plan.md</span>.
      </p>
    </main>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <div
      className="rounded-md border border-border bg-card p-5"
      style={{ borderColor: "var(--border-strong)" }}
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

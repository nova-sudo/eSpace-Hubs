"use client";

/**
 * Manager Hub — Employees roster. Renders at /[hub]/employees.
 *
 * The list of the manager's direct reports; each opens that report's
 * goal board (/[hub]/employees/:id). Replaces the P0 placeholder for
 * this slot.
 *
 * Data: GET /manager/reports.
 */

import Link from "next/link";
import { MonoLabel, PageHeader } from "@/components/ui";
import { useHubLink } from "@/features/hubs";
import { useManagerReports } from "./use-manager-reports";

function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function ManagerEmployees() {
  const link = useHubLink();
  const { loading, reports, error } = useManagerReports();

  return (
    <main className="relative z-[2] mx-auto max-w-4xl px-10 pb-14 pt-9">
      <PageHeader
        crumb="Employees · pick someone to open their board"
        title="Every report, in depth."
        italicWord="depth"
        subtitle="Open a teammate to see their full goal board and where each goal stands on the achievement tiers."
      />

      <div className="mt-2">
        <MonoLabel>Your reports</MonoLabel>
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
              <span className="text-fg">User management</span>.
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

function EmptyCard({ children }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-card p-6 text-[13px] leading-[1.6] text-muted-fg">
      {children}
    </div>
  );
}

"use client";

/**
 * Manager Hub — Employees roster. Renders at /[hub]/employees.
 *
 * The list of the manager's direct reports; each opens that report's
 * goal board (/[hub]/employees/:id). Search + department filter +
 * group-by-department are client-side only — a manager's roster is
 * small enough (single-digit to low double-digit reports) that fetching
 * everything and slicing in the browser is simpler than a server-side
 * query builder, and it keeps GET /manager/reports a single cheap call.
 *
 * Data: GET /manager/reports.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge, FilterChip, Label, PageHeader, Input, Select } from "@/components/ui";
import { useHubLink } from "@/features/hubs";
import { cn } from "@/lib/cn";
import { useManagerReports } from "./use-manager-reports";

function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

const UNASSIGNED = "Unassigned";

export function ManagerEmployees() {
  const link = useHubLink();
  const { loading, reports, error } = useManagerReports();
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("");
  const [grouped, setGrouped] = useState(false);

  const departments = useMemo(() => {
    const set = new Set(reports.map((r) => r.department || UNASSIGNED));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [reports]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reports.filter((r) => {
      const d = r.department || UNASSIGNED;
      if (dept && d !== dept) return false;
      if (!q) return true;
      return (
        r.displayName?.toLowerCase().includes(q) ||
        r.email?.toLowerCase().includes(q) ||
        r.role?.toLowerCase().includes(q)
      );
    });
  }, [reports, query, dept]);

  const groups = useMemo(() => {
    if (!grouped) return null;
    const byDept = new Map();
    for (const r of filtered) {
      const d = r.department || UNASSIGNED;
      if (!byDept.has(d)) byDept.set(d, []);
      byDept.get(d).push(r);
    }
    return Array.from(byDept.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, grouped]);

  return (
    <main className="max-w-[1280px] mx-auto px-4 sm:px-10 pb-16 pt-7">
      <PageHeader
        crumb="Employees · pick someone to open their board"
        title="Every report, in depth."
        subtitle="Open a teammate to see their full goal board and where each goal stands on the achievement tiers."
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email, role…"
          className="max-w-[260px]"
          aria-label="Search reports"
        />
        <Select
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          placeholder="All departments"
          aria-label="Filter by department"
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
        <FilterChip
          label="Group"
          value="by department"
          active={grouped}
          onClick={() => setGrouped((g) => !g)}
        />
        {(query || dept) && !loading ? (
          <span className="text-[12.5px] text-muted-fg">
            {filtered.length} of {reports.length}
          </span>
        ) : null}
      </div>

      <div className="mt-6">
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
            <span className="text-fg font-bold">User management</span>.
          </EmptyCard>
        ) : filtered.length === 0 ? (
          <EmptyCard>No one matches that search.</EmptyCard>
        ) : groups ? (
          <div className="grid gap-7">
            {groups.map(([d, rows]) => (
              <div key={d}>
                <Label>
                  {d} · {rows.length}
                </Label>
                <ReportList rows={rows} link={link} className="mt-3" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <Label>Your reports</Label>
            <ReportList rows={filtered} link={link} className="mt-3" />
          </>
        )}
      </div>
    </main>
  );
}

function ReportList({ rows, link, className }) {
  return (
    <ul className={cn("grid gap-2", className)}>
      {rows.map((r) => (
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
            {r.level ? <Badge>{r.level}</Badge> : null}
            <span className="flex items-center gap-1 text-[12.5px] font-bold text-fg">
              View board <ArrowRight size={13} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
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

"use client";

/**
 * Admin hub — org chart. Renders at /[hub]/org-chart (hub-audit §2.4).
 *
 * The reporting tree built from every member's `managerId`, so the things
 * a one-user-at-a-time editor hides become visible: people with no
 * manager, reports of a disabled manager, a manager who lost the role,
 * dangling pointers, reporting loops, and a manager with 40 reports.
 * Each flag links to the Members list filtered to the people it names.
 *
 *   GET /admin/org-chart → { nodes, rootIds, cycles, stats }
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { Avatar, Badge, Input, Label, Loading, PageHeader } from "@/components/ui";
import { useHubLink } from "@/features/hubs";
import { cn } from "@/lib/cn";
import { AdminShell } from "./admin-shell";
import { EmptyState, StatusBadge } from "./admin-ui";

/** A team this size or bigger is called out. */
const LARGE_TEAM = 12;

const FLAG_META = {
  no_manager: { label: "No manager", tone: "lemon" },
  manager_disabled: { label: "Manager disabled", tone: "peach" },
  manager_missing: { label: "Manager not found", tone: "peach" },
  manager_not_manager: { label: "Manager lacks role", tone: "lemon" },
  in_cycle: { label: "Reporting loop", tone: "peach" },
};

export function AdminOrgChart() {
  const link = useHubLink();
  const [state, setState] = useState({ loading: true, error: null, chart: null });
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await apiGet("/admin/org-chart");
      if (cancelled) return;
      setState(
        r.ok
          ? { loading: false, error: null, chart: r.data }
          : { loading: false, error: r.error?.message || "Couldn't load the org chart.", chart: null },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = useMemo(() => {
    const m = new Map();
    for (const n of state.chart?.nodes ?? []) m.set(n.id, n);
    return m;
  }, [state.chart]);

  // Search: keep matches plus every ancestor on their path, so a match
  // is always shown in context.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const keep = new Set();
    for (const n of byId.values()) {
      const hit =
        n.displayName.toLowerCase().includes(q) || n.email.toLowerCase().includes(q);
      if (!hit) continue;
      let cur = n;
      const seen = new Set();
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        keep.add(cur.id);
        cur = cur.managerId ? byId.get(cur.managerId) : null;
      }
    }
    return keep;
  }, [query, byId]);

  function toggle(id) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const chart = state.chart;
  const stats = chart?.stats;
  const largest = stats?.largestTeam ? byId.get(stats.largestTeam.managerId) : null;
  // Roots with reports first (the real tree), then the people with nobody
  // above or below them.
  const roots = (chart?.rootIds ?? [])
    .map((id) => byId.get(id))
    .filter(Boolean)
    .sort((a, b) => b.reportIds.length - a.reportIds.length || a.displayName.localeCompare(b.displayName));

  return (
    <AdminShell active="orgchart">
      <PageHeader
        crumb="Admin · org chart"
        title="Who reports to whom."
        subtitle="Built from each member's manager. Flags point at the people whose approvals have nowhere to go."
        right={
          <div className="relative min-w-[200px]">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Find a person in the org chart"
              placeholder="Find a person"
              className="h-9 bg-card text-[13px]"
            />
          </div>
        }
      />

      {state.loading ? (
        <Loading label="Loading the org chart" />
      ) : state.error ? (
        <Panel>
          <EmptyState title="Couldn't load the org chart." body={state.error} />
        </Panel>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <FlagTile
              label="No manager"
              value={stats.noManager}
              hint="Devs and QA whose approvals go to admins"
              href={stats.noManager ? link("/users?flag=no_manager") : null}
            />
            <FlagTile
              label="Disabled manager"
              value={stats.disabledManagerReports}
              hint="Reports whose manager can't sign in"
              href={stats.disabledManagerReports ? link("/users?flag=disabled_manager") : null}
            />
            <FlagTile
              label="Reporting loops"
              value={stats.cycles}
              hint="Chains that circle back on themselves"
            />
            <FlagTile
              label="Largest team"
              value={stats.largestTeam?.reports ?? 0}
              hint={largest ? largest.displayName : "Nobody has reports yet"}
              href={largest ? link(`/users?managerId=${largest.id}`) : null}
            />
          </div>

          {chart.cycles.length > 0 ? (
            <Panel className="mb-4">
              <Label>Reporting loops</Label>
              <p className="mt-1 text-[12.5px] text-muted-fg">
                Nobody in a loop reaches the top of the tree. Give one of them a manager outside the loop.
              </p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {chart.cycles.map((loop) => (
                  <li key={loop.join(",")} className="text-[13px] font-semibold text-fg">
                    {[...loop, loop[0]].map((id) => byId.get(id)?.displayName ?? id).join(" → ")}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel>
            {roots.length === 0 ? (
              <EmptyState title="No tree to draw." body="Everyone sits inside a reporting loop — see above." />
            ) : (
              // Plain nested lists: role="tree" promises an arrow-key model
              // this chart doesn't have. The expand buttons carry the state.
              <ul aria-label="Org chart">
                {roots
                  .filter((n) => !visible || visible.has(n.id))
                  .map((n) => (
                    <TreeNode
                      key={n.id}
                      node={n}
                      depth={0}
                      byId={byId}
                      visible={visible}
                      collapsed={collapsed}
                      onToggle={toggle}
                      link={link}
                      trail={new Set()}
                    />
                  ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </AdminShell>
  );
}

function TreeNode({ node, depth, byId, visible, collapsed, onToggle, link, trail }) {
  // `trail` guards against a loop that somehow hangs off a root.
  if (trail.has(node.id)) return null;
  const nextTrail = new Set(trail).add(node.id);
  const reports = node.reportIds
    .map((id) => byId.get(id))
    .filter((r) => r && (!visible || visible.has(r.id)))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const isOpen = !collapsed.has(node.id) || Boolean(visible);
  const large = node.reportIds.length >= LARGE_TEAM;
  return (
    <li>
      <div
        className={cn(
          "flex items-center gap-2 border-t border-line py-2",
          depth === 0 && "first:border-t-0",
          node.status === "disabled" && "opacity-60",
        )}
        style={{ paddingLeft: depth * 22 }}
      >
        {reports.length ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            aria-expanded={isOpen}
            aria-label={`${node.displayName}'s team`}
            className="grid h-6 w-6 place-items-center rounded-[var(--radius-md)] text-muted-fg hover:bg-card-alt"
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-6" />
        )}
        <Avatar name={node.displayName} size={24} tone={node.roles.includes("manager") ? "sky" : "lav"} />
        <Link
          href={link(`/users?q=${encodeURIComponent(node.email)}`)}
          className="min-w-0 truncate text-[13px] font-semibold text-fg hover:underline"
        >
          {node.displayName}
        </Link>
        {node.reportIds.length ? (
          <Badge tone={large ? "lemon" : "neutral"}>
            {node.reportIds.length} report{node.reportIds.length === 1 ? "" : "s"}
          </Badge>
        ) : null}
        {node.status !== "active" ? <StatusBadge status={node.status} /> : null}
        {node.flags.map((f) => (
          <Badge key={f} tone={FLAG_META[f]?.tone ?? "neutral"}>
            {FLAG_META[f]?.label ?? f}
          </Badge>
        ))}
      </div>
      {reports.length && isOpen ? (
        <ul aria-label={`${node.displayName}'s reports`}>
          {reports.map((r) => (
            <TreeNode
              key={r.id}
              node={r}
              depth={depth + 1}
              byId={byId}
              visible={visible}
              collapsed={collapsed}
              onToggle={onToggle}
              link={link}
              trail={nextTrail}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function FlagTile({ label, value, hint, href }) {
  const body = (
    <>
      <Label>{label}</Label>
      <div className="mt-1.5 text-[32px] font-extrabold leading-none tracking-[-0.03em] tabular-nums text-fg">
        {value}
      </div>
      <div className="mt-1.5 truncate text-[12px] text-muted-fg">{hint}</div>
    </>
  );
  const cls = "block rounded-[var(--radius-xl)] bg-card p-4";
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:bg-card-alt")} style={{ boxShadow: "var(--shadow-card)" }}>
      {body}
    </Link>
  ) : (
    <div className={cls} style={{ boxShadow: "var(--shadow-card)" }}>
      {body}
    </div>
  );
}

function Panel({ children, className }) {
  return (
    <div className={cn("rounded-[var(--radius-xl)] bg-card px-5 py-3", className)} style={{ boxShadow: "var(--shadow-card)" }}>
      {children}
    </div>
  );
}

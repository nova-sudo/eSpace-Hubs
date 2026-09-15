"use client";

/**
 * Team view "People" — the relationship rail.
 *
 * The person is the nav item: a left rail of reports (with a dot on
 * anyone who needs attention) and that person's standing on the right.
 * It's the view for "how is Maya doing" rather than "who is behind",
 * which is what the table is for — the two exist side by side because
 * a lead asks both questions and neither layout answers both well.
 *
 * Data: the roster + rollup the page already holds, plus one
 * goal-health call for whoever is selected (the same endpoint their
 * board reads, so the objectives here are the objectives there).
 */

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Avatar, Badge, Card, Label } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useReportHealth } from "./use-report-health";
import { CountTile, EmptyCard, TierSpreadBar, TierSpreadLegend } from "./manager-ui";

export function TeamPeopleView({ reports, perReport, link, toolCounts }) {
  const [selectedId, setSelectedId] = useState(reports[0]?.id ?? null);
  const selected =
    reports.find((r) => r.id === selectedId) ?? reports[0] ?? null;
  const { loading, data, error } = useReportHealth(selected?.id ?? null);

  const stat = perReport.get(selected?.id) ?? null;
  const summary = data?.summary ?? null;
  const ungraded = Math.max(
    0,
    (summary?.total ?? stat?.total ?? 0) - (summary?.graded ?? stat?.graded ?? 0),
  );

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
      <Card padding={12}>
        <Label className="mb-2 block px-2">Direct reports</Label>
        <div className="grid gap-0.5">
          {reports.map((r) => {
            const active = r.id === selected?.id;
            const attention = (perReport.get(r.id)?.needsAttention ?? 0) > 0;
            return (
              <button
                key={r.id}
                type="button"
                aria-pressed={active}
                onClick={() => setSelectedId(r.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-[var(--radius-lg)] p-2 text-left transition-colors",
                  active ? "bg-card-alt" : "hover:bg-card-alt",
                )}
              >
                <Avatar
                  name={r.displayName}
                  size={26}
                  tone={attention ? "peach" : "lav"}
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[12.5px]",
                    active ? "font-bold text-fg" : "text-muted-fg",
                  )}
                >
                  {r.displayName}
                </span>
                {attention ? (
                  <span
                    aria-label="Needs attention"
                    title="Needs attention"
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-peach-ink"
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="mt-3 border-t border-line pt-3">
          <Label className="mb-1.5 block px-2">Team tools</Label>
          {[
            { href: "/delegated", label: "Delegated", count: toolCounts.delegated },
            { href: "/approvals", label: "Approvals", count: toolCounts.approvals },
            { href: "/tier-policies", label: "Tier policies", count: null },
          ].map((tool) => (
            <Link
              key={tool.href}
              href={link(tool.href)}
              className="flex items-center gap-2 rounded-[var(--radius-lg)] px-2 py-2 transition-colors hover:bg-card-alt"
            >
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-fg">
                {tool.label}
              </span>
              {tool.count ? <Badge tone="lav">{tool.count}</Badge> : null}
              <ChevronRight size={14} className="shrink-0 text-dim-fg" />
            </Link>
          ))}
        </div>
      </Card>

      {!selected ? (
        <EmptyCard>Pick a report on the left to see where they stand.</EmptyCard>
      ) : (
        <Card>
          <div className="flex flex-wrap items-center gap-3.5">
            <Avatar name={selected.displayName} size={46} />
            <div className="min-w-0 flex-1">
              <div className="text-[18px] font-bold tracking-[-0.01em] text-fg">
                {selected.displayName}
              </div>
              <div className="mt-0.5 truncate text-[12.5px] text-muted-fg">
                {[selected.role, selected.department, selected.level]
                  .filter(Boolean)
                  .join(" · ") || selected.email}
              </div>
            </div>
            <Link
              href={link(`/employees/${selected.id}`)}
              className="inline-flex h-9 shrink-0 items-center rounded-[var(--radius-pill)] bg-ink px-5 text-[13px] font-bold text-ink-on transition-opacity hover:opacity-90"
            >
              {ungraded ? `Grade ${ungraded} ungraded` : "Open their board"}
            </Link>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <CountTile label="Goals" value={summary?.total ?? stat?.total ?? "—"} />
            <CountTile label="Graded" value={summary?.graded ?? stat?.graded ?? "—"} />
            <CountTile
              label="Need setup"
              value={summary?.needsSetup ?? stat?.needsSetup ?? "—"}
            />
            <CountTile
              label="Delegated to you"
              value={summary?.delegatedToYou ?? stat?.delegatedToYou ?? "—"}
            />
          </div>

          <div className="mt-4 border-t border-line pt-4">
            <Label>Tier spread</Label>
            <TierSpreadBar
              byTier={summary?.byTier ?? stat?.byTier}
              height={9}
              className="mt-2"
            />
            <TierSpreadLegend
              byTier={summary?.byTier ?? stat?.byTier}
              total={summary?.total ?? stat?.total ?? 0}
              className="mt-2.5"
            />
          </div>

          <div className="mt-4 border-t border-line pt-4">
            <Label>Goals by objective</Label>
            {loading ? (
              <p className="mt-2 text-[13px] text-muted-fg">Loading their goals…</p>
            ) : error || !data ? (
              <p className="mt-2 text-[13px] text-muted-fg">
                Couldn&apos;t load their goals right now. Their board still opens.
              </p>
            ) : data.groups.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted-fg">
                {selected.displayName.split(" ")[0]} hasn&apos;t set up any goals
                yet.
              </p>
            ) : (
              <div className="mt-1.5">
                {data.groups.map((group) => {
                  const total = group.goals.length;
                  const graded = group.goals.filter((g) => g.tier).length;
                  return (
                    <Link
                      key={group.l1.id}
                      href={link(`/employees/${selected.id}`)}
                      className="flex items-center gap-3 border-t border-line py-2.5 transition-colors hover:opacity-80"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg">
                        {group.l1.title}
                      </span>
                      {group.l1.weightage ? (
                        <Badge tone="lav">{group.l1.weightage}% of the year</Badge>
                      ) : null}
                      <Badge tone={graded === total ? "mint" : "lemon"}>
                        {graded} of {total} graded
                      </Badge>
                      <ChevronRight size={15} className="shrink-0 text-muted-fg" />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

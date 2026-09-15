"use client";

/**
 * Team view "Table" — one row per report, with the team totals sitting
 * on top of the column they belong to.
 *
 * This is the comparison surface: at six reports "64% across the team"
 * is one number standing in for six stories, so every column here is
 * per-person and reads down. The last column is the tier spread — the
 * `byTier` histogram the API returns for each report — because "9 of 12
 * graded" says how much is done and only the spread says what it said.
 */

import Link from "next/link";
import { Avatar, Badge, Label } from "@/components/ui";
import { cn } from "@/lib/cn";
import { percent } from "./manager-format";
import { MiniBar, TierSpreadBar } from "./manager-ui";

const COLS =
  "grid grid-cols-[minmax(160px,1.6fr)_72px_104px_104px_minmax(120px,1fr)_88px] items-center gap-4";

export function TeamTableView({ rows, totals, totalsLoading, link }) {
  return (
    <div
      className="overflow-hidden rounded-[var(--radius-xl)] bg-card"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="overflow-x-auto">
        <div className="min-w-[760px] px-5 pb-5 pt-4">
          <div className={cn(COLS, "border-b border-line pb-2.5")}>
            <Label>Report</Label>
            <Label>Goals</Label>
            <Label>Graded</Label>
            <Label>Needs setup</Label>
            <Label>Tier spread</Label>
            <span />
          </div>

          {/* Totals first: the row every other row is read against. */}
          <div
            className={cn(
              COLS,
              "-mx-5 border-b border-line bg-card-alt px-5 py-2.5",
            )}
          >
            <span className="text-[13px] font-bold text-fg">
              All {rows.length} report{rows.length === 1 ? "" : "s"}
            </span>
            <span className="text-[13px] font-bold tabular-nums text-fg">
              {totalsLoading ? "—" : totals.goals}
            </span>
            <div>
              <span className="text-[12.5px] font-bold tabular-nums text-fg">
                {totalsLoading ? "—" : `${percent(totals.graded, totals.goals)}%`}
              </span>
              <MiniBar value={totals.graded} total={totals.goals} className="mt-1" />
            </div>
            <span
              className={cn(
                "text-[13px] font-bold tabular-nums",
                totals.needsSetup ? "text-fg" : "text-dim-fg",
              )}
            >
              {totalsLoading ? "—" : totals.needsSetup}
            </span>
            <TierSpreadBar byTier={totals.byTier} height={7} />
            <span />
          </div>

          {rows.map(({ report, stat }) => (
            <div key={report.id} className={cn(COLS, "border-b border-line py-3")}>
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar
                  name={report.displayName}
                  size={30}
                  tone={stat.needsAttention ? "peach" : "lav"}
                />
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-bold text-fg">
                    {report.displayName}
                  </div>
                  <div className="truncate text-[11.5px] text-muted-fg">
                    {[report.role, report.department].filter(Boolean).join(" · ") ||
                      report.email}
                  </div>
                </div>
              </div>
              <span className="text-[13px] font-bold tabular-nums text-fg">
                {stat.total}
              </span>
              <div>
                <span className="text-[12.5px] font-bold tabular-nums text-fg">
                  {stat.graded}/{stat.total}
                </span>
                <MiniBar value={stat.graded} total={stat.total} className="mt-1" />
              </div>
              <span>
                {stat.needsAttention ? (
                  <Badge tone="peach">{stat.needsAttention}</Badge>
                ) : (
                  <span className="text-[12.5px] tabular-nums text-dim-fg">0</span>
                )}
              </span>
              <TierSpreadBar byTier={stat.byTier} height={7} />
              <div className="text-right">
                <Link
                  href={link(`/employees/${report.id}`)}
                  className="inline-flex h-9 items-center rounded-[var(--radius-pill)] bg-card-alt px-4 text-[13px] font-semibold text-fg transition-colors hover:opacity-80"
                >
                  Open
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

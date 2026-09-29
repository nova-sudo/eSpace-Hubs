"use client";

/**
 * Team view "Table" — one row per report, sorted by who needs you first,
 * with the team totals sitting on top of the column they belong to.
 *
 * The first three columns answer "who needs attention" without opening
 * anyone's board:
 *   Logging        the report's weakest measured goal in the SHARED status
 *                  words ("Behind · Gone quiet · 3 weeks…") — the same
 *                  words they see on their own Home
 *   Last check-in  when they last logged anything
 *   Packet         their latest review packet: new (you haven't opened it)
 *                  / seen / none
 * Then the grading columns: graded, your grades this period, needs setup,
 * and the tier spread (`byTier`) — "9 of 12 graded" says how much is done,
 * only the spread says what it said.
 */

import Link from "next/link";
import { Avatar, Badge, Label } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ago, percent } from "./manager-format";
import { MiniBar, TierSpreadBar } from "./manager-ui";

const COLS =
  "grid grid-cols-[minmax(170px,1.4fr)_minmax(170px,1.3fr)_96px_84px_92px_104px_84px_minmax(110px,1fr)_72px] items-center gap-4";

function LoggingCell({ worst }) {
  if (!worst) return <span className="text-[12.5px] text-muted-fg">No goals yet</span>;
  return (
    <div className="min-w-0">
      <Badge tone={worst.tone} dot>
        {worst.label}
      </Badge>
      {worst.reason || worst.goalTitle ? (
        <div
          className="mt-1 truncate text-[11.5px] text-muted-fg"
          title={[worst.reason, worst.goalTitle].filter(Boolean).join(" · ")}
        >
          {[worst.reason, worst.goalTitle].filter(Boolean).join(" · ")}
        </div>
      ) : null}
    </div>
  );
}

function PacketCell({ packet, disputes }) {
  return (
    <div className="flex flex-col items-start gap-1">
      {packet ? (
        packet.state === "new" ? (
          <Badge tone="sky" dot>
            New
          </Badge>
        ) : (
          <span className="text-[12.5px] text-muted-fg">Seen</span>
        )
      ) : (
        <span className="text-[12.5px] text-muted-fg">None</span>
      )}
      {disputes ? (
        <Badge tone="peach">
          {disputes} {disputes === 1 ? "disagreement" : "disagreements"}
        </Badge>
      ) : null}
    </div>
  );
}

export function TeamTableView({ rows, totals, totalsLoading, progress, link }) {
  const pt = progress?.totals ?? null;
  return (
    <div
      className="overflow-hidden rounded-[var(--radius-xl)] bg-card"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="overflow-x-auto">
        <div className="min-w-[1120px] px-5 pb-5 pt-4">
          <div className={cn(COLS, "border-b border-line pb-2.5")}>
            <Label>Report</Label>
            <Label>Logging</Label>
            <Label>Last check-in</Label>
            <Label>Packet</Label>
            <Label>Graded</Label>
            <Label>Your grades {progress?.periodKey ?? ""}</Label>
            <Label>Needs setup</Label>
            <Label>Tier spread</Label>
            <span />
          </div>

          {/* Totals first: the row every other row is read against. One
              report is its own total, so the row only shows for two+. */}
          {rows.length > 1 ? (
            <div
             
              className={cn(COLS, "-mx-5 border-b border-line bg-card-alt px-5 py-2.5")}
            >
              <span className="text-[13px] font-bold text-fg">All {rows.length} reports</span>
              <span className="text-[12.5px] text-muted-fg">
                {totalsLoading
                  ? "—"
                  : `${rows.filter((r) => r.stat.behind > 0).length} with goals behind`}
              </span>
              <span />
              <span className="text-[12.5px] text-muted-fg">
                {totalsLoading ? "—" : `${totals.newPackets} new`}
              </span>
              <div>
                <span className="text-[12.5px] font-bold tabular-nums text-fg">
                  {totalsLoading ? "—" : `${percent(totals.graded, totals.goals)}%`}
                </span>
                <MiniBar value={totals.graded} total={totals.goals} className="mt-1" />
              </div>
              <div>
                <span className="text-[12.5px] font-bold tabular-nums text-fg">
                  {pt ? `${pt.graded}/${pt.total}` : "—"}
                </span>
                <MiniBar value={pt?.graded ?? 0} total={pt?.total ?? 0} className="mt-1" />
              </div>
              <span
                className={cn(
                  "text-[13px] font-bold tabular-nums",
                  totals.needsSetup ? "text-fg" : "text-muted-fg",
                )}
              >
                {totalsLoading ? "—" : totals.needsSetup}
              </span>
              <TierSpreadBar byTier={totals.byTier} height={7} />
              <span />
            </div>
          ) : null}

          {rows.map(({ report, stat }) => (
            <div key={report.id} className={cn(COLS, "border-b border-line py-3")}>
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar name={report.displayName} size={30} />
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
              <LoggingCell worst={stat.worst} />
              <span className="text-[12.5px] text-fg">
                {ago(stat.lastEntryAt) ?? <span className="text-muted-fg">Never</span>}
              </span>
              <PacketCell packet={stat.packet} disputes={stat.openDisputes} />
              <div>
                <span className="text-[12.5px] font-bold tabular-nums text-fg">
                  {stat.graded}/{stat.total}
                </span>
                <MiniBar value={stat.graded} total={stat.total} className="mt-1" />
              </div>
              <ProgressCell row={progress?.byId?.get(report.id)} />
              <span>
                {stat.needsSetup ? (
                  <Badge tone="lemon">{stat.needsSetup}</Badge>
                ) : (
                  <span className="text-[12.5px] tabular-nums text-muted-fg">0</span>
                )}
              </span>
              <TierSpreadBar byTier={stat.byTier} height={7} />
              <div className="text-right">
                <Link
                  href={link(`/employees/${report.id}`)}
                  className="inline-flex h-9 items-center rounded-[var(--radius-pill)] bg-card-alt px-4 text-[13px] font-semibold text-fg transition-colors hover:opacity-80"
                  aria-label={`Open ${report.displayName}'s board`}
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

/** One report's "your grades this period" cell — n/m plus a ratio bar. */
function ProgressCell({ row }) {
  if (!row) return <span className="text-[12.5px] tabular-nums text-muted-fg">—</span>;
  return (
    <div>
      <span className="text-[12.5px] font-bold tabular-nums text-fg">
        {row.graded}/{row.total}
      </span>
      <MiniBar value={row.graded} total={row.total} className="mt-1" />
    </div>
  );
}

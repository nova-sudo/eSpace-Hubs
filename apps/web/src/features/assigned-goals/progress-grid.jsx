"use client";

/**
 * People × periods. One tinted cell per (assignee, period):
 *   mint   on time      peach  late / missing      lemon  open (due soon)
 *   card-alt upcoming
 * Each cell says its status in words too (color is never the only signal)
 * and opens the values behind it. Rows sort worst-first by default so the
 * people who need a nudge are at the top.
 */

import { useMemo, useState } from "react";
import { Badge, Button, SegmentedControl } from "@/components/ui";
import { cn } from "@/lib/cn";

export const STATUS_META = {
  on_time: { label: "On time", short: "On time", cls: "bg-mint text-mint-ink" },
  late: { label: "Late", short: "Late", cls: "bg-peach text-peach-ink" },
  // Same tint as late (both are "behind"), but outlined so the two read
  // apart at a glance — and the word is always printed in the cell.
  missing: {
    label: "Missing",
    short: "Missing",
    cls: "bg-peach text-peach-ink ring-2 ring-inset ring-peach-ink",
  },
  open: { label: "Open", short: "Open", cls: "bg-lemon text-lemon-ink" },
  upcoming: { label: "Upcoming", short: "—", cls: "bg-card-alt text-muted-fg" },
};

const DAY_FMT = { day: "numeric", month: "short" };
const STAMP_FMT = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };

export function fmtDay(ms) {
  return ms ? new Date(ms).toLocaleDateString("en-GB", DAY_FMT) : "—";
}
export function fmtStamp(ms) {
  return ms ? new Date(ms).toLocaleString("en-GB", STAMP_FMT) : "—";
}
export function pct(x) {
  return x == null ? "—" : `${Math.round(x * 100)}%`;
}

function lateness(row) {
  return row.summary.missing * 2 + row.summary.late;
}

const SORTS = [
  { value: "attention", label: "Needs attention" },
  { value: "name", label: "Name" },
];

export const TIER_META = {
  not_achieved: { label: "Not achieved", tone: "peach" },
  achieved: { label: "Achieved", tone: "mint" },
  over_achieved: { label: "Over achieved", tone: "sky" },
  role_model: { label: "Role model", tone: "lav" },
};

export function ProgressGrid({ windows, rows, onOpenCell, verdicts = {}, onGrade = null }) {
  const [sort, setSort] = useState("attention");
  const sorted = useMemo(() => {
    const list = [...rows];
    if (sort === "name") {
      list.sort((a, b) => a.user.displayName.localeCompare(b.user.displayName));
    } else {
      list.sort(
        (a, b) =>
          lateness(b) - lateness(a) || a.user.displayName.localeCompare(b.user.displayName),
      );
    }
    return list;
  }, [rows, sort]);

  if (rows.length === 0) {
    return <div className="text-[13px] text-muted-fg">No assignees yet.</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Legend />
        <SegmentedControl options={SORTS} value={sort} onChange={setSort} size="sm" onCard />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-[180px] border-b border-line bg-card px-2 py-2 text-left text-[12px] font-semibold text-muted-fg">
                Person
              </th>
              {windows.map((w) => (
                <th
                  key={w.key ?? "once"}
                  className="min-w-[92px] border-b border-line px-1 py-2 text-left text-[12px] font-semibold text-muted-fg"
                  title={`Due ${fmtDay(w.deadline)}`}
                >
                  <div className="truncate">{w.label}</div>
                  <div className="text-[11px] font-medium text-muted-fg">due {fmtDay(w.deadline)}</div>
                </th>
              ))}
              <th className="min-w-[88px] border-b border-line px-2 py-2 text-right text-[12px] font-semibold text-muted-fg">
                On time
              </th>
              <th className="min-w-[120px] border-b border-line px-2 py-2 text-left text-[12px] font-semibold text-muted-fg">
                Grade
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.user.id}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-t border-line bg-card px-2 py-1.5 text-left font-normal"
                >
                  <div className="truncate text-[14px] font-bold text-fg">{row.user.displayName}</div>
                  <div className="text-[12px] text-muted-fg">
                    {row.summary.late ? `${row.summary.late} late` : null}
                    {row.summary.late && row.summary.missing ? " · " : null}
                    {row.summary.missing ? `${row.summary.missing} missing` : null}
                    {!row.summary.late && !row.summary.missing
                      ? row.summary.due
                        ? "All caught up"
                        : "Nothing due yet"
                      : null}
                  </div>
                </th>
                {row.cells.map((c) => {
                  const meta = STATUS_META[c.status] ?? STATUS_META.upcoming;
                  const clickable = c.status !== "upcoming" || c.submittedAt;
                  const tip =
                    c.submittedAt != null
                      ? `${meta.label} · submitted ${fmtStamp(c.submittedAt)}${c.approx ? " (approx.)" : ""}${
                          c.lastEditedAt && c.lastEditedAt !== c.submittedAt
                            ? ` · edited ${fmtStamp(c.lastEditedAt)}`
                            : ""
                        } · ${c.filledFields}/${c.totalFields} fields`
                      : `${meta.label} · due ${fmtStamp(c.deadline)}`;
                  return (
                    <td key={c.key ?? "once"} className="border-t border-line px-1 py-1.5">
                      <button
                        type="button"
                        disabled={!clickable}
                        onClick={() => onOpenCell?.(row.user, c)}
                        title={tip}
                        aria-label={`${row.user.displayName}, ${c.label}: ${tip}`}
                        className={cn(
                          "flex h-12 w-full flex-col justify-center rounded-[var(--radius-md)] px-2 text-left",
                          meta.cls,
                          clickable ? "hover:opacity-85" : "cursor-default",
                        )}
                      >
                        <span className="text-[12px] font-bold leading-tight">{meta.short}</span>
                        {c.submittedAt != null ? (
                          <span className="text-[11px] font-semibold leading-tight opacity-80">
                            {fmtDay(c.submittedAt)}
                            {c.approx ? "~" : ""}
                          </span>
                        ) : null}
                      </button>
                    </td>
                  );
                })}
                <td className="border-t border-line px-2 py-1.5 text-right text-[14px] font-bold tabular-nums">
                  {pct(row.summary.onTimeRate)}
                </td>
                <td className="border-t border-line px-2 py-1.5">
                  <GradeCell verdict={verdicts[row.user.id]} onGrade={onGrade ? () => onGrade(row.user) : null} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Legend() {
  const items = ["on_time", "late", "missing", "open", "upcoming"];
  return (
    <div className="flex flex-wrap items-center gap-3 text-[12px] font-semibold text-muted-fg">
      {items.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={cn("inline-block h-3.5 w-3.5 rounded-full", STATUS_META[k].cls)} />
          {STATUS_META[k].label}
        </span>
      ))}
    </div>
  );
}

function GradeCell({ verdict, onGrade }) {
  const meta = verdict ? TIER_META[verdict.tier] : null;
  if (!onGrade) {
    return meta ? <Badge tone={meta.tone}>{meta.label}</Badge> : <span className="text-[12px] text-muted-fg">—</span>;
  }
  return (
    <Button type="button" variant={meta ? "ghost" : "soft"} size="sm" onClick={onGrade}>
      {meta ? <Badge tone={meta.tone}>{meta.label}</Badge> : "Grade"}
    </Button>
  );
}

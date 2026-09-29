"use client";

/**
 * Team view "Calibration" — every report side by side on the tier
 * ladder for one grading period, which is what a lead does at review
 * time: is my "achieved" for Maya the same bar as my "achieved" for Sam?
 *
 * Rows are reports; columns are the MANAGER grades in the period (latest
 * per goal, from the verdict history's periodKey — a previous manager's
 * included for anyone reassigned to you) counted per tier, plus how
 * many the report disputed and how many they've seen. Every column
 * sorts. Data: GET /manager/grading-progress?periodKey=.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Avatar, Badge, Label, Select } from "@/components/ui";
import { TIER_LABELS } from "@/features/goal-tiers";
import { cn } from "@/lib/cn";
import { EmptyCard, MiniBar, TierSpreadBar } from "./manager-ui";
import { currentPeriodKey, useGradingProgress } from "./use-grading-progress";

const COLS =
  "grid grid-cols-[minmax(160px,1.5fr)_96px_repeat(4,76px)_76px_64px_minmax(100px,1fr)] items-center gap-3";

const TIER_COLS = ["role_model", "over_achieved", "achieved", "not_achieved"];

const COLUMNS = [
  { key: "name", label: "Report" },
  { key: "graded", label: "Graded" },
  ...TIER_COLS.map((t) => ({ key: t, label: TIER_LABELS[t] })),
  { key: "disputed", label: "Disputed" },
  { key: "acknowledged", label: "Seen" },
];

function sortValue(row, key) {
  if (key === "name") return row.displayName?.toLowerCase() ?? "";
  if (key === "graded") return row.total ? row.graded / row.total : -1;
  if (TIER_COLS.includes(key)) return row.byTier?.[key] ?? 0;
  return row[key] ?? 0;
}

export function sortCalibrationRows(rows, key, dir) {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    if (av < bv) return -1 * sign;
    if (av > bv) return 1 * sign;
    return (a.displayName ?? "").localeCompare(b.displayName ?? "");
  });
}

export function TeamCalibrationView({ visibleIds, link }) {
  const thisYear = currentPeriodKey();
  const [periodKey, setPeriodKey] = useState(thisYear);
  const [sort, setSort] = useState({ key: "graded", dir: "asc" });
  const { loading, error, reports, totals } = useGradingProgress(periodKey);

  const rows = useMemo(() => {
    const scoped = visibleIds ? reports.filter((r) => visibleIds.has(r.id)) : reports;
    return sortCalibrationRows(scoped, sort.key, sort.dir);
  }, [reports, visibleIds, sort]);

  const years = [thisYear, String(Number(thisYear) - 1), String(Number(thisYear) - 2)];

  function toggle(key) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" ? "asc" : "desc" },
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <Label>Grading period</Label>
        <Select
          value={periodKey}
          onChange={(e) => setPeriodKey(e.target.value)}
          aria-label="Grading period"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
        <span className="text-[12.5px] text-muted-fg">
          {totals && !loading
            ? `${totals.graded} of ${totals.total} goals graded for ${periodKey}` +
              (totals.disputed ? ` · ${totals.disputed} disputed` : "")
            : null}
        </span>
      </div>

      {error ? (
        <EmptyCard>Couldn&apos;t load grading for this period. Refresh, or check back in a moment.</EmptyCard>
      ) : loading ? (
        <EmptyCard>Loading grades…</EmptyCard>
      ) : rows.length === 0 ? (
        <EmptyCard>No one to compare yet.</EmptyCard>
      ) : (
        <div
          className="overflow-hidden rounded-[var(--radius-xl)] bg-card"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <div className="overflow-x-auto">
            <div className="min-w-[900px] px-5 pb-5 pt-4">
              <div className={cn(COLS, "border-b border-line pb-2.5")}>
                {COLUMNS.map((c) => {
                  const active = sort.key === c.key;
                  // Sort state lives in the button's name — aria-sort is only
                  // valid on a columnheader, and this is a CSS grid, not a table.
                  const state = active
                    ? `sorted ${sort.dir === "asc" ? "ascending" : "descending"}`
                    : "not sorted";
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => toggle(c.key)}
                      aria-label={`${c.label}, ${state}. Sort by ${c.label}`}
                      className="flex items-center gap-1 text-left"
                    >
                      <Label className={active ? "text-fg" : undefined}>{c.label}</Label>
                      {active ? (
                        sort.dir === "asc" ? (
                          <ArrowUp size={11} aria-hidden="true" />
                        ) : (
                          <ArrowDown size={11} aria-hidden="true" />
                        )
                      ) : null}
                    </button>
                  );
                })}
                <Label>Spread</Label>
              </div>

              {rows.map((r) => (
                <div key={r.id} className={cn(COLS, "border-b border-line py-3")}>
                  <Link
                    href={link(`/employees/${r.id}`)}
                    className="flex min-w-0 items-center gap-2.5 hover:opacity-80"
                  >
                    <Avatar name={r.displayName} size={28} tone={r.disputed ? "peach" : "lav"} />
                    <span className="truncate text-[13.5px] font-bold text-fg">
                      {r.displayName}
                    </span>
                  </Link>
                  <div>
                    <span className="text-[12.5px] font-bold tabular-nums text-fg">
                      {r.graded}/{r.total}
                    </span>
                    <MiniBar value={r.graded} total={r.total} className="mt-1" />
                  </div>
                  {TIER_COLS.map((t) => (
                    <span
                      key={t}
                      className={cn(
                        "text-[13px] tabular-nums",
                        r.byTier?.[t] ? "font-bold text-fg" : "text-muted-fg",
                      )}
                    >
                      {r.byTier?.[t] ?? 0}
                    </span>
                  ))}
                  <span>
                    {r.disputed ? (
                      <Badge tone="peach">{r.disputed}</Badge>
                    ) : (
                      <span className="text-[13px] tabular-nums text-muted-fg">0</span>
                    )}
                  </span>
                  <span className="text-[13px] tabular-nums text-muted-fg">{r.acknowledged}</span>
                  <TierSpreadBar byTier={r.byTier} height={7} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <p className="text-[12px] leading-[1.55] text-muted-fg">
        Counts manager grades — the latest per goal filed under {periodKey}, including a
        previous manager&apos;s for anyone reassigned to you. AI tiers aren&apos;t counted
        here; they show on each report&apos;s board.
      </p>
    </div>
  );
}

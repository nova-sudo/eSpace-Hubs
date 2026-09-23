/**
 * Pure shaping for the shared-goal analytics grid: one row per assignee,
 * one cell per period, plus per-period and overall rollups. The per-cell
 * status comes from the shared `periodStatuses`, so the grid, the scheduler
 * nudges and the assignee's own chip agree on who is late.
 */

import {
  assignedWindows,
  periodStatuses,
  summarizeStatuses,
  type AssignedPeriodCell,
  type AssignedStatusSummary,
} from "@espace-devhub/shared/goal-specs";

export interface ProgressUser {
  id: string;
  displayName: string;
  email: string | null;
}

export interface ProgressEntry {
  userId: string;
  ts: Date | number | string;
  createdAt?: Date | number | string | null;
  value: unknown;
}

export interface ProgressRow {
  user: ProgressUser;
  cells: Array<Omit<AssignedPeriodCell, "start" | "end">>;
  summary: AssignedStatusSummary;
}

export interface ProgressWindow {
  key: string | null;
  label: string;
  start: number;
  end: number;
  deadline: number;
  counts: { onTime: number; late: number; missing: number; open: number; upcoming: number };
}

export interface ProgressResult {
  windows: ProgressWindow[];
  rows: ProgressRow[];
  totals: AssignedStatusSummary & { assignees: number };
}

function ms(v: Date | number | string | null | undefined): number | null {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  const n = Date.parse(v);
  return Number.isNaN(n) ? null : n;
}

export function buildProgress(args: {
  spec: Record<string, unknown>;
  users: ProgressUser[];
  entries: ProgressEntry[];
  graceHours: number;
  timeZone?: string;
  now?: number;
}): ProgressResult {
  const now = args.now ?? Date.now();
  const graceMs = Math.max(0, args.graceHours || 0) * 3_600_000;

  const byUser = new Map<string, ProgressEntry[]>();
  for (const e of args.entries) {
    const list = byUser.get(e.userId) ?? [];
    list.push(e);
    byUser.set(e.userId, list);
  }

  const rows: ProgressRow[] = args.users.map((user) => {
    const cells = periodStatuses({
      spec: args.spec,
      now,
      graceMs,
      timeZone: args.timeZone,
      entries: (byUser.get(user.id) ?? []).map((e) => ({
        ts: ms(e.ts),
        createdAt: ms(e.createdAt ?? null),
        value: e.value,
      })),
    });
    return {
      user,
      cells: cells.map(({ start: _s, end: _e, ...rest }) => rest),
      summary: summarizeStatuses(cells),
    };
  });

  // Windows come from the spec alone; take deadlines from the first row's
  // cells when there is one (identical for everybody), else recompute.
  const baseCells =
    rows.length > 0
      ? null
      : periodStatuses({ spec: args.spec, now, graceMs, timeZone: args.timeZone, entries: [] });
  const windows: ProgressWindow[] = assignedWindows(args.spec, now).map((w, i) => {
    const counts = { onTime: 0, late: 0, missing: 0, open: 0, upcoming: 0 };
    for (const r of rows) {
      const s = r.cells[i]?.status;
      if (s === "on_time") counts.onTime += 1;
      else if (s === "late") counts.late += 1;
      else if (s === "missing") counts.missing += 1;
      else if (s === "open") counts.open += 1;
      else counts.upcoming += 1;
    }
    const cell = rows[0]?.cells[i] ?? baseCells?.[i];
    return {
      key: w.key,
      label: cell?.label ?? w.label,
      start: w.start,
      end: w.end,
      deadline: cell?.deadline ?? w.end,
      counts,
    };
  });

  const allCells = rows.flatMap((r) => r.cells);
  return {
    windows,
    rows,
    totals: { ...summarizeStatuses(allCells as AssignedPeriodCell[]), assignees: rows.length },
  };
}

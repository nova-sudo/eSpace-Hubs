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

/** One assignee's linked GitHub issue for one period (github_links). */
export interface ProgressLink {
  userId: string;
  periodIndex: number;
  issueState: "open" | "closed" | "missing" | null;
  /** GitHub's state_reason; "not_planned" never counts as closed-done. */
  stateReason?: string | null;
  issueNumber?: number | null;
  issueUrl: string | null;
  tasks: { done: number; total: number } | null;
  closedAt: Date | string | null;
  lastSyncedAt: Date | string | null;
  stale: boolean;
}

/** What a grid cell says about its GitHub issue — display only, never a status. */
export interface CellGithub {
  state: "open" | "closed" | "missing" | null;
  stateReason: string | null;
  issueNumber: number | null;
  issueUrl: string | null;
  tasks: { done: number; total: number } | null;
  closedAt: string | null;
  lastSyncedAt: string | null;
  stale: boolean;
}

export type ProgressCell = Omit<AssignedPeriodCell, "start" | "end"> & { github: CellGithub | null };

export interface ProgressRow {
  user: ProgressUser;
  cells: ProgressCell[];
  summary: AssignedStatusSummary;
}

export interface ProgressWindow {
  key: string | null;
  label: string;
  start: number;
  end: number;
  deadline: number;
  counts: {
    onTime: number;
    late: number;
    missing: number;
    open: number;
    upcoming: number;
    before: number;
    closedOnGithub: number;
  };
}

export interface ProgressResult {
  windows: ProgressWindow[];
  rows: ProgressRow[];
  totals: AssignedStatusSummary & { assignees: number; closedOnGithub: number };
}

function ms(v: Date | number | string | null | undefined): number | null {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  const n = Date.parse(v);
  return Number.isNaN(n) ? null : n;
}

function iso(v: Date | string | null | undefined): string | null {
  const n = ms(v ?? null);
  return n == null ? null : new Date(n).toISOString();
}

function toCellGithub(l: ProgressLink): CellGithub {
  return {
    state: l.issueState ?? null,
    stateReason: l.stateReason ?? null,
    issueNumber: l.issueNumber ?? null,
    issueUrl: l.issueUrl ?? null,
    tasks: l.tasks ?? null,
    closedAt: iso(l.closedAt),
    lastSyncedAt: iso(l.lastSyncedAt),
    stale: Boolean(l.stale),
  };
}

/** Closed on GitHub as done (a "not planned" close is not). */
function isClosedDone(g: CellGithub | null | undefined): boolean {
  return g?.state === "closed" && g.stateReason !== "not_planned";
}

export function buildProgress(args: {
  spec: Record<string, unknown>;
  users: ProgressUser[];
  entries: ProgressEntry[];
  graceHours: number;
  timeZone?: string;
  now?: number;
  /**
   * When the assignees' tracker started counting — the assignment's
   * creation. Windows that ended before it are "before" (optional
   * backfill), never "missing".
   */
  trackingStart?: number | null;
  /**
   * Linked GitHub issues, keyed onto cells by (userId, cell.index). They
   * only annotate a cell — a closed issue already became a reading via the
   * github-links sync, so the status rules never look at this.
   */
  links?: ProgressLink[];
}): ProgressResult {
  const now = args.now ?? Date.now();
  const trackingStart = args.trackingStart ?? null;
  const graceMs = Math.max(0, args.graceHours || 0) * 3_600_000;

  const byUser = new Map<string, ProgressEntry[]>();
  for (const e of args.entries) {
    const list = byUser.get(e.userId) ?? [];
    list.push(e);
    byUser.set(e.userId, list);
  }

  const linkBy = new Map<string, ProgressLink>();
  for (const l of args.links ?? []) linkBy.set(`${l.userId}|${l.periodIndex}`, l);

  const rows: ProgressRow[] = args.users.map((user) => {
    const cells = periodStatuses({
      spec: args.spec,
      now,
      graceMs,
      timeZone: args.timeZone,
      trackingStart,
      entries: (byUser.get(user.id) ?? []).map((e) => ({
        ts: ms(e.ts),
        createdAt: ms(e.createdAt ?? null),
        value: e.value,
      })),
    });
    return {
      user,
      cells: cells.map(({ start: _s, end: _e, ...rest }) => {
        const link = linkBy.get(`${user.id}|${rest.index}`);
        return { ...rest, github: link ? toCellGithub(link) : null };
      }),
      summary: summarizeStatuses(cells),
    };
  });

  // Windows come from the spec alone; take deadlines from the first row's
  // cells when there is one (identical for everybody), else recompute.
  const baseCells =
    rows.length > 0
      ? null
      : periodStatuses({ spec: args.spec, now, graceMs, timeZone: args.timeZone, trackingStart, entries: [] });
  const windows: ProgressWindow[] = assignedWindows(args.spec, now).map((w, i) => {
    const counts = { onTime: 0, late: 0, missing: 0, open: 0, upcoming: 0, before: 0, closedOnGithub: 0 };
    for (const r of rows) {
      if (isClosedDone(r.cells[i]?.github)) counts.closedOnGithub += 1;
      const s = r.cells[i]?.status;
      if (s === "on_time") counts.onTime += 1;
      else if (s === "late") counts.late += 1;
      else if (s === "missing") counts.missing += 1;
      else if (s === "open") counts.open += 1;
      else if (s === "before") counts.before += 1;
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
    totals: {
      ...summarizeStatuses(allCells as unknown as AssignedPeriodCell[]),
      assignees: rows.length,
      closedOnGithub: allCells.filter((c) => isClosedDone(c.github)).length,
    },
  };
}

/**
 * Pure rollups behind the manager's team-level surfaces (§1.5 of
 * docs/hub-audit.md). No I/O — the controller feeds rows in, so the
 * arithmetic is unit-tested without a database.
 *
 *   gradingProgressFor   "Graded 4 of 11 goals for 2026" + the tier
 *                        spread and dispute count behind the
 *                        calibration table, per report
 *   snapshotSeries       one report's weekly snapshot headline series
 *                        (the team trend sparklines)
 */

import type {
  GoalTier,
  ManagerGoalVerdictEvent,
  Snapshot,
} from "../../db/types.js";
import { latestPerGoalPerPeriod } from "../../lib/manager-verdicts.js";

export type TierCounts = Record<GoalTier, number>;

export function emptyTierCounts(): TierCounts {
  return { not_achieved: 0, achieved: 0, over_achieved: 0, role_model: 0 };
}

export interface GradingProgress {
  /** Goals on the report's current tree (own + assigned). */
  total: number;
  /** Of those, how many carry a MANAGER grade in the period. */
  graded: number;
  byTier: TierCounts;
  /** Latest grade in the period acknowledged as seen (agreeing). */
  acknowledged: number;
  /** Latest grade in the period the report disagreed with. */
  disputed: number;
}

type EventLike = Pick<
  ManagerGoalVerdictEvent,
  "goalId" | "periodKey" | "gradedAt" | "tier" | "ack"
>;

/**
 * One report's grading progress for `periodKey`. `goalIds` is the
 * report's CURRENT goal set — a grade on a goal that has since been
 * removed doesn't count toward "graded N of M", so the ratio never
 * exceeds 100%. `events` may span periods; only `periodKey` counts, and
 * within it the latest grade per goal wins (a re-grade isn't two grades).
 */
export function gradingProgressFor(
  goalIds: readonly string[],
  events: readonly EventLike[],
  periodKey: string,
): GradingProgress {
  const goals = new Set(goalIds);
  const latest = latestPerGoalPerPeriod(
    events.filter((e) => e.periodKey === periodKey && goals.has(e.goalId)),
  );
  const out: GradingProgress = {
    total: goals.size,
    graded: 0,
    byTier: emptyTierCounts(),
    acknowledged: 0,
    disputed: 0,
  };
  for (const e of latest.values()) {
    out.graded += 1;
    if (e.tier in out.byTier) out.byTier[e.tier] += 1;
    if (e.ack?.disagree) out.disputed += 1;
    else if (e.ack) out.acknowledged += 1;
  }
  return out;
}

/** Sum per-report progress into the team line. */
export function sumGradingProgress(rows: readonly GradingProgress[]): GradingProgress {
  const out: GradingProgress = {
    total: 0,
    graded: 0,
    byTier: emptyTierCounts(),
    acknowledged: 0,
    disputed: 0,
  };
  for (const r of rows) {
    out.total += r.total;
    out.graded += r.graded;
    out.acknowledged += r.acknowledged;
    out.disputed += r.disputed;
    for (const t of Object.keys(out.byTier) as GoalTier[]) {
      out.byTier[t] += r.byTier[t] ?? 0;
    }
  }
  return out;
}

// ─── snapshot series ─────────────────────────────────────────────────

const WEEK_RE = /^W(\d{1,2})-(\d{4})$/;

/**
 * A sortable key for a snapshot week: year*100 + week. Year-qualified
 * labels ("W16-2026") parse directly; legacy year-less labels ("W16")
 * borrow the year they were captured in.
 */
export function weekSortKey(week: string, capturedAt: Date): number {
  const m = WEEK_RE.exec(week);
  if (m) return Number(m[2]) * 100 + Number(m[1]);
  const bare = /^W(\d{1,2})$/.exec(week);
  const year = capturedAt.getUTCFullYear();
  return year * 100 + (bare ? Number(bare[1]) : 0);
}

export interface SnapshotPoint {
  week: string;
  capturedAt: string;
  capturedBy: Snapshot["capturedBy"];
  partial: boolean;
  /**
   * PRs merged that week — null when the snapshot was frozen by the
   * scheduler without provider metrics (a 0 there means "unknown", not
   * "none", and would drag the sparkline to the floor).
   */
  merged: number | null;
  reviews: number | null;
  /** Goals with a reading that week, and how many met their window. */
  goalsTracked: number;
  goalsMet: number;
}

type SnapshotLike = Pick<
  Snapshot,
  | "week"
  | "capturedAt"
  | "capturedBy"
  | "partial"
  | "gaps"
  | "merged"
  | "reviews"
  | "goalReadings"
>;

/**
 * One report's weekly headline series, oldest week first, deduplicated
 * by week (the latest capture wins). The snapshot's free-text `note` is
 * the report's own and deliberately never leaves this function.
 */
export function snapshotSeries(rows: readonly SnapshotLike[]): SnapshotPoint[] {
  const byWeek = new Map<number, SnapshotLike>();
  for (const r of rows) {
    const k = weekSortKey(r.week, r.capturedAt);
    const prev = byWeek.get(k);
    if (!prev || r.capturedAt.getTime() >= prev.capturedAt.getTime()) {
      byWeek.set(k, r);
    }
  }
  return [...byWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, r]) => {
      const noProvider = (r.gaps ?? []).includes("provider-metrics");
      const readings = Object.values(r.goalReadings ?? {});
      return {
        week: r.week,
        capturedAt: r.capturedAt.toISOString(),
        capturedBy: r.capturedBy,
        partial: r.partial === true,
        merged: noProvider || !Number.isFinite(r.merged) ? null : r.merged,
        reviews: noProvider || !Number.isFinite(r.reviews) ? null : r.reviews,
        goalsTracked: readings.length,
        goalsMet: readings.filter((g) => g?.windowMet === true).length,
      };
    });
}

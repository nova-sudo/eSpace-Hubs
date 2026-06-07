"use client";

/**
 * Aggregate goal-compliance across EVERY classified goal — the data behind
 * the Overview "Goal compliance" tile.
 *
 * Returns `{ met, assessable, pct }`:
 *   - assessable: classified, non-delegated, non-untrackable goals we can
 *     judge an on-pace standing for. A goal is excluded only when its
 *     standing is genuinely indeterminate (a reflection/free-text goal, an
 *     un-graded rubric, an auto goal with no snapshot reading yet).
 *   - met: assessable goals currently on pace / meeting target.
 *   - pct: round(met / assessable * 100), or null when nothing is
 *     assessable yet.
 *
 * Standing is computed from LIVE data — the same goal-inputs the widgets
 * render — so manual goals (milestone, recurring-milestone, incident,
 * counter, scale, before/after) are counted immediately, with no snapshot
 * or backfill required. AUTO widgets (merged-count, turnaround, …) fall
 * back to their latest snapshot reading, since judging those live would
 * need a full integration fetch here.
 */

import { useMemo } from "react";
import { useSnapshots } from "./use-snapshots";
import { goalCompliance } from "./compliance";
import { useGoals } from "@/features/goals";
import { useGoalSpecs, SPEC_KINDS } from "@/features/goal-specs";
import {
  useAllGoalInputs,
  readInputs,
  getInputsState,
  computeCompliance,
} from "@/features/goal-inputs";

/** Snapshot-derived standing (the historical weekly-window read). */
function snapshotStanding(c) {
  if (!c) return null;
  if (c.inProgress) {
    if (c.inProgress.onPace != null) return c.inProgress.onPace === true;
    if (c.inProgress.windowMet != null) return c.inProgress.windowMet === true;
  }
  // windows are newest-first → first closed window with a boolean is the
  // most recent authoritative reading.
  for (const w of c.windows || []) {
    if (w.closed && w.reading?.windowMet != null) {
      return w.reading.windowMet === true;
    }
  }
  return null;
}

/** value `op` target → boolean. Defaults to ">=" semantics. */
function cmpTarget(value, target) {
  const t = target.value;
  if (target.op === "<=") return value <= t;
  if (target.op === "=") return Math.abs(value - t) <= 0.1 * Math.max(1, Math.abs(t));
  return value >= t;
}

/**
 * Current on-pace standing for ONE goal from live data.
 *   true  → on pace / meeting target
 *   false → behind / breached
 *   null  → can't be judged (excluded from the denominator)
 */
function liveStanding(spec, entries, snapshots, goalId) {
  if (!spec || spec.delegated?.delegated || spec.untrackable) return null;
  const list = Array.isArray(entries) ? entries : [];
  const latest = list.length ? list[list.length - 1] : null;

  switch (spec.widget) {
    // Checklists — on pace when the latest period is fully ticked.
    case SPEC_KINDS.MILESTONE:
    case SPEC_KINDS.RECURRING_MILESTONE: {
      const items = latest?.value?.items;
      if (!Array.isArray(items) || items.length === 0) return null;
      return items.every((it) => it && it.done);
    }
    // Current-state rating — strong at the target (or 4/5 by default).
    case SPEC_KINDS.SCALE: {
      const v =
        latest && Number.isFinite(Number(latest.value))
          ? Number(latest.value)
          : null;
      if (v == null) return null;
      const t = spec.manual?.target;
      return t && Number.isFinite(t.value) ? cmpTarget(v, t) : v >= 4;
    }
    // Cadence-bucketed sum — is THIS window meeting target?
    case SPEC_KINDS.COUNTER: {
      const c = computeCompliance(list, spec.manual?.target, spec.manual?.cadence);
      return c ? c.latestWindowMet : null;
    }
    // Frequency log — count this window's entries against the target.
    case SPEC_KINDS.DATE_LOG: {
      const t = spec.manual?.target;
      if (!t) return null;
      const counted = list.map((e) => ({ ts: e.ts, value: 1 }));
      const c = computeCompliance(counted, t, spec.manual?.cadence);
      return c ? c.latestWindowMet : null;
    }
    // Lower-is-better — on pace when at/under target, or (no target) zero.
    case SPEC_KINDS.INCIDENT_LOG: {
      const count = list.filter((e) => e && e.value != null).length;
      const t = spec.manual?.target;
      return t && Number.isFinite(t.value) ? cmpTarget(count, t) : count === 0;
    }
    // Improvement — current beats baseline (lower-is-better default, same
    // assumption capture-readings makes).
    case SPEC_KINDS.BEFORE_AFTER: {
      const b = Number(latest?.value?.baseline);
      const cur = Number(latest?.value?.current);
      if (!Number.isFinite(b) || !Number.isFinite(cur)) return null;
      return cur < b;
    }
    // Reflection notes have no on-pace notion.
    case SPEC_KINDS.FREE_TEXT:
      return null;
    // Auto widgets + code-rubric + scorecard: latest snapshot reading.
    default:
      return snapshotStanding(goalCompliance(snapshots, goalId));
  }
}

export function useComplianceSummary() {
  const { snapshots } = useSnapshots();
  const { goals, fetched: goalsFetched } = useGoals();
  const { specs, fetched: specsFetched } = useGoalSpecs();
  // Subscribe to the inputs store tick so the summary recomputes when the
  // user logs/ticks anything (and so the one-shot hydration fires).
  const inputsTick = useAllGoalInputs();
  // `ready` gates the tile's empty state: until goals + specs + inputs have
  // all hydrated, "0 tracked" would be a hydration artefact, not the truth.
  const ready = goalsFetched && specsFetched && getInputsState().fetched;

  return useMemo(() => {
    const byGoal = readInputs() || {};
    let met = 0;
    let assessable = 0;
    const seen = new Set();
    for (const l1 of goals?.l1s || []) {
      for (const g of [l1, ...(l1.l2s || [])]) {
        if (!g?.id || seen.has(g.id)) continue;
        seen.add(g.id);
        const spec = specs.get(g.id);
        if (!spec) continue;
        const standing = liveStanding(spec, byGoal[g.id] || [], snapshots, g.id);
        if (standing == null) continue;
        assessable += 1;
        if (standing) met += 1;
      }
    }
    return {
      met,
      assessable,
      ready,
      pct: assessable > 0 ? Math.round((met / assessable) * 100) : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshots, goals, specs, inputsTick, ready]);
}

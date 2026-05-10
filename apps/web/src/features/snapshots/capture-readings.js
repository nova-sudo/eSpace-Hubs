/**
 * Pure goal-reading capture for the auto-snapshotter.
 *
 * Given the user's goals + classified specs + integration data + manual
 * inputs at a moment in time, returns a `goalReadings` map suitable for
 * embedding in a snapshot:
 *
 *   { [goalId]: {
 *       cadence, cadenceWindow,
 *       weekContribution, cumulative,
 *       target, windowMet, onPace
 *     } }
 *
 * Three guiding principles:
 *
 *   1. **Cadence-aware.** Each goal's reading carries its own cadence
 *      and the cadence-window the snapshot's week falls into. A weekly
 *      mentor goal gets `cadenceWindow: "W17-2026"`. A quarterly
 *      Merged-PR goal in week 17 gets `cadenceWindow: "2026-Q2"`. So
 *      when the compliance helper later groups by `cadenceWindow`, the
 *      4-13 weekly snapshots inside one quarterly window collapse to
 *      one met/unmet evaluation.
 *
 *   2. **Sticky met for >=, recompute for <=.** Once a `>=` cumulative
 *      target is hit inside its window, it stays met even if later
 *      weeks don't add more. A `<=` target (lower-is-better) is
 *      re-evaluated every snapshot — late-week MRs with messy review
 *      threads can degrade the week's standing.
 *
 *   3. **No re-fetching.** This module operates on data the caller
 *      already has in hand (mrs, events, jira tickets, allInputs).
 *      It's pure synchronous JS. The auto-snapshotter (or backfill
 *      job) is responsible for assembling the inputs.
 */

import { SPEC_KINDS } from "@/features/goal-specs";
import {
  avgReviewerComments,
  countMrComments,
  linkagePct,
  medianTurnaroundDays,
} from "@/features/integrations";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Capture goal readings for a single week.
 *
 * @param {{
 *   weekStart: Date,           // Sunday 00:00
 *   weekEnd:   Date,           // Thursday EOD (Friday 00:00)
 *   goals:     { l1s: [...] }, // user's goal tree
 *   specs:     Map<goalId, spec>, // classified specs
 *   mrs:       Array<MR>,      // merged PRs visible in this snapshot's window
 *   events:    Array<Event>,   // event-feed entries (90d-capped)
 *   tickets:   Array<JiraIssue>,
 *   allInputs: { [goalId]: Array<entry> },
 *   priorReadings?: { [goalId]: Reading } | null,
 *   //   When set, used to compute "cumulative" for cadence-windows that
 *   //   span multiple weeks (we add this week's contribution to whatever
 *   //   the prior snapshot recorded for the same window). For
 *   //   weekly-cadence goals, ignored.
 * }} ctx
 * @returns {Object<string, GoalReading>}
 */
export function captureGoalReadings(ctx) {
  const { goals, specs } = ctx;
  const out = {};

  for (const l1 of goals?.l1s || []) {
    pushReading(out, l1, ctx);
    for (const l2 of l1.l2s || []) {
      pushReading(out, l2, ctx);
    }
  }
  return out;
}

function pushReading(out, goal, ctx) {
  if (!goal?.id) return;
  const spec = ctx.specs.get?.(goal.id) || ctx.specs[goal.id];
  if (!spec) return;
  const reading = readGoal(spec, goal, ctx);
  if (reading) out[goal.id] = reading;
}

/* ─────────────────────────── per-widget readers ─────────────────────────── */

function readGoal(spec, goal, ctx) {
  // Delegated goals are tracked externally — we record the cadence
  // window so the snapshot stream is complete, but contribution / met
  // are null because the user isn't producing the data.
  if (spec?.delegated?.delegated) {
    return baseReading(spec, ctx, {
      weekContribution: null,
      cumulative: null,
      windowMet: null,
      onPace: null,
    });
  }

  switch (spec.widget) {
    // ── Auto widgets ──────────────────────────────────────────────────
    case SPEC_KINDS.MERGED_COUNT:
      return readMerged(spec, ctx);
    case SPEC_KINDS.REVIEW_ROUNDS:
      return readRounds(spec, ctx);
    case SPEC_KINDS.TURNAROUND:
      return readTurnaround(spec, ctx);
    case SPEC_KINDS.LINKAGE:
      return readLinkage(spec, ctx);
    case SPEC_KINDS.TICKET_CYCLE:
      return readTicketCycle(spec, ctx);
    case SPEC_KINDS.CODE_RUBRIC:
      // Rubric grading is decoupled (PRs graded asynchronously). We
      // record the count of merged PRs in this window for context;
      // compliance-from-snapshots aggregates it.
      return readRubric(spec, ctx);

    // ── Manual widgets ────────────────────────────────────────────────
    case SPEC_KINDS.COUNTER:
      return readCounter(spec, goal, ctx);
    case SPEC_KINDS.SCALE:
      return readScale(spec, goal, ctx);
    case SPEC_KINDS.MILESTONE:
      return readMilestone(spec, goal, ctx);
    case SPEC_KINDS.DATE_LOG:
      return readDateLog(spec, goal, ctx);
    case SPEC_KINDS.FREE_TEXT:
      return readFreeText(spec, goal, ctx);
    case SPEC_KINDS.BEFORE_AFTER:
      return readBeforeAfter(spec, goal, ctx);

    default:
      return null;
  }
}

/* ── auto ── */

function readMerged(spec, ctx) {
  // Merged-PR count for THIS week (between weekStart and weekEnd).
  const weekCount = mrsInWindow(ctx.mrs, ctx.weekStart, ctx.weekEnd).length;
  const cumulative = cumulativeForWindow(spec, ctx, weekCount);
  const target = spec.source?.target;
  return baseReading(spec, ctx, {
    weekContribution: weekCount,
    cumulative,
    windowMet: evalMet(cumulative, target, "sticky"),
    onPace: evalOnPace(cumulative, target, ctx),
  });
}

function readRounds(spec, ctx) {
  const inWindow = mrsInWindow(ctx.mrs, ctx.weekStart, ctx.weekEnd);
  const avg = avgReviewerComments(inWindow);
  const target = spec.source?.target;
  return baseReading(spec, ctx, {
    weekContribution: avg,
    cumulative: avg, // weekly cadence — same as week
    windowMet: evalMet(avg, target, "recompute"),
  });
}

function readTurnaround(spec, ctx) {
  const inWindow = mrsInWindow(ctx.mrs, ctx.weekStart, ctx.weekEnd);
  const medianDays = medianTurnaroundDays(inWindow);
  const medianHours = medianDays != null ? medianDays * 24 : null;
  const target = spec.source?.target; // typically expressed in hours
  return baseReading(spec, ctx, {
    weekContribution: medianHours,
    cumulative: medianHours,
    windowMet: evalMet(medianHours, target, "recompute"),
  });
}

function readLinkage(spec, ctx) {
  const inWindow = mrsInWindow(ctx.mrs, ctx.weekStart, ctx.weekEnd);
  const result = linkagePct(inWindow);
  const pct = result?.pct ?? null;
  const target = spec.source?.target;
  return baseReading(spec, ctx, {
    weekContribution: pct,
    cumulative: pct,
    windowMet: evalMet(pct, target, "recompute"),
  });
}

function readTicketCycle(spec, ctx) {
  // Lightweight — count of in-window-touched tickets. Detailed cycle
  // time would need per-ticket transition data we don't have today.
  const count = (ctx.tickets || []).length;
  return baseReading(spec, ctx, {
    weekContribution: count,
    cumulative: count,
    windowMet: null,
  });
}

function readRubric(spec, ctx) {
  const inWindow = mrsInWindow(ctx.mrs, ctx.weekStart, ctx.weekEnd);
  return baseReading(spec, ctx, {
    weekContribution: inWindow.length,
    cumulative: inWindow.length,
    windowMet: null, // Grading verdicts live in their own store
  });
}

/* ── manual ── */

function readCounter(spec, goal, ctx) {
  const entries = ctx.allInputs[goal.id] || [];
  const weekValue = sumNumericInWindow(entries, ctx.weekStart, ctx.weekEnd);
  const cumulative = cumulativeForWindow(spec, ctx, weekValue);
  const target = spec.manual?.target;
  return baseReading(spec, ctx, {
    weekContribution: weekValue,
    cumulative,
    windowMet: evalMet(cumulative, target, "sticky"),
    onPace: evalOnPace(cumulative, target, ctx),
  });
}

function readScale(spec, goal, ctx) {
  // Latest rating that fell INSIDE the window (Scale is "current state",
  // not cumulative).
  const entries = ctx.allInputs[goal.id] || [];
  const inWindow = entries.filter(
    (e) =>
      e.ts >= ctx.weekStart.getTime() && e.ts < ctx.weekEnd.getTime() &&
      Number.isFinite(Number(e.value)),
  );
  const latest = inWindow[inWindow.length - 1];
  const value = latest ? Number(latest.value) : null;
  return baseReading(spec, ctx, {
    weekContribution: value,
    cumulative: value,
    windowMet: value != null ? value >= 4 : null, // 4+ on a 1-5 scale = "strong"
  });
}

function readMilestone(spec, goal, ctx) {
  // Milestone widgets store a list of items as their value. We capture
  // the latest snapshot (if any) of "items done / total".
  const entries = ctx.allInputs[goal.id] || [];
  const upToWeek = entries.filter((e) => e.ts <= ctx.weekEnd.getTime());
  const latest = upToWeek[upToWeek.length - 1];
  const items = Array.isArray(latest?.value?.items) ? latest.value.items : [];
  const done = items.filter((it) => it.done).length;
  const total = items.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : null;
  return baseReading(spec, ctx, {
    weekContribution: null,
    cumulative: pct,
    windowMet: pct === 100 ? true : pct == null ? null : false,
  });
}

function readDateLog(spec, goal, ctx) {
  const entries = ctx.allInputs[goal.id] || [];
  const weekCount = entries.filter(
    (e) =>
      e.ts >= ctx.weekStart.getTime() && e.ts < ctx.weekEnd.getTime(),
  ).length;
  const cumulative = cumulativeForWindow(spec, ctx, weekCount);
  return baseReading(spec, ctx, {
    weekContribution: weekCount,
    cumulative,
    windowMet: null, // no numeric target on date-log
  });
}

function readFreeText(spec, goal, ctx) {
  const entries = ctx.allInputs[goal.id] || [];
  const weekCount = entries.filter(
    (e) =>
      e.ts >= ctx.weekStart.getTime() && e.ts < ctx.weekEnd.getTime(),
  ).length;
  return baseReading(spec, ctx, {
    weekContribution: weekCount,
    cumulative: entries.filter((e) => e.ts <= ctx.weekEnd.getTime()).length,
    windowMet: null,
  });
}

function readBeforeAfter(spec, goal, ctx) {
  const entries = ctx.allInputs[goal.id] || [];
  const upToWeek = entries.filter((e) => e.ts <= ctx.weekEnd.getTime());
  const latest = upToWeek[upToWeek.length - 1];
  const baseline = Number(latest?.value?.baseline);
  const current = Number(latest?.value?.current);
  if (!Number.isFinite(baseline) || !Number.isFinite(current)) {
    return baseReading(spec, ctx, {
      weekContribution: null,
      cumulative: null,
      windowMet: null,
    });
  }
  const delta = current - baseline;
  // Direction matters per goal — assume lower-is-better unless the
  // spec says otherwise. The vast majority of before/after goals are
  // "reduce X" (response time, error rate, etc.).
  const improved = delta < 0;
  return baseReading(spec, ctx, {
    weekContribution: null,
    cumulative: current,
    windowMet: improved,
  });
}

/* ─────────────────────────── helpers ─────────────────────────── */

/**
 * Foundation reading — fills in cadence, cadenceWindow, target, asOf —
 * leaving the per-widget fields the caller must supply.
 */
function baseReading(spec, ctx, fields) {
  const cadence = spec.manual?.cadence || inferCadenceFromSource(spec) || "weekly";
  const target = spec.manual?.target || spec.source?.target || null;
  return {
    cadence,
    cadenceWindow: cadenceWindowFor(cadence, ctx.weekEnd),
    weekContribution: fields.weekContribution ?? null,
    cumulative: fields.cumulative ?? null,
    target: target ? { op: target.op, value: target.value } : null,
    windowMet: fields.windowMet ?? null,
    onPace: fields.onPace ?? null,
  };
}

function inferCadenceFromSource(spec) {
  // Auto widgets express cadence indirectly via the metric window.
  // We translate `quarter` / `90d` / `30d` into a goal-cadence label.
  const w = spec.source?.window;
  if (!w) return null;
  if (w === "quarter") return "quarterly";
  if (w === "year") return "yearly";
  if (w === "30d" || w === "month") return "monthly";
  // 90d, week, custom — default to weekly bucket since that's the
  // snapshot cadence and it's the most useful for compliance reads.
  return "weekly";
}

/**
 * Build the cadence-window label for the given cadence, using the
 * snapshot's week-end (the Thursday at end of capture) to anchor.
 *
 * Examples (week ending Thu Apr 23 2026):
 *   weekly     → "W17-2026"
 *   monthly    → "2026-04"
 *   quarterly  → "2026-Q2"
 *   yearly     → "2026"
 *   continuous → "lifetime"
 *   milestone  → "lifetime"
 */
function cadenceWindowFor(cadence, weekEnd) {
  const d = weekEnd instanceof Date ? weekEnd : new Date(weekEnd);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  switch (cadence) {
    case "yearly":
      return `${year}`;
    case "quarterly": {
      const q = Math.floor((month - 1) / 3) + 1;
      return `${year}-Q${q}`;
    }
    case "monthly":
      return `${year}-${String(month).padStart(2, "0")}`;
    case "biweekly": {
      const wk = sunWeekNumber(d);
      const fortnight = Math.ceil(wk / 2);
      return `${year}-F${String(fortnight).padStart(2, "0")}`;
    }
    case "weekly":
      return `W${String(sunWeekNumber(d)).padStart(2, "0")}-${year}`;
    case "daily":
      return d.toISOString().slice(0, 10);
    default:
      return "lifetime";
  }
}

/**
 * Sun-anchored ISO-ish week number. Week 1 contains Jan 1 (regardless
 * of how many days fall in the prior year — keeps boundaries simple
 * for a year-aligned perf cycle).
 */
function sunWeekNumber(d) {
  const year = d.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const daysSinceJan1 = Math.floor((d.getTime() - jan1.getTime()) / DAY);
  return Math.floor(daysSinceJan1 / 7) + 1;
}

function mrsInWindow(mrs, start, end) {
  if (!Array.isArray(mrs)) return [];
  const s = start.getTime();
  const e = end.getTime();
  return mrs.filter((m) => {
    if (!m.merged_at) return false;
    const t = new Date(m.merged_at).getTime();
    return t >= s && t < e;
  });
}

function sumNumericInWindow(entries, start, end) {
  if (!Array.isArray(entries)) return 0;
  const s = start.getTime();
  const e = end.getTime();
  let sum = 0;
  for (const entry of entries) {
    if (entry.ts < s || entry.ts >= e) continue;
    const n = Number(entry.value);
    if (Number.isFinite(n)) sum += n;
  }
  return sum;
}

/**
 * For cadence-windows that span multiple snapshots (monthly, quarterly,
 * yearly), running cumulative = previous-week's cumulative + this-week's
 * contribution, IF the previous week sits in the SAME cadence-window.
 * Otherwise we're at the start of a new window — just this week's
 * contribution.
 */
function cumulativeForWindow(spec, ctx, weekContribution) {
  const cadence =
    spec.manual?.cadence || inferCadenceFromSource(spec) || "weekly";
  if (cadence === "weekly" || cadence === "daily" || cadence === "biweekly") {
    return weekContribution;
  }
  const prior = ctx.priorReadings?.[spec.goalId];
  if (!prior) return weekContribution;
  const sameWindow =
    prior.cadenceWindow === cadenceWindowFor(cadence, ctx.weekEnd);
  if (!sameWindow) return weekContribution;
  return (prior.cumulative ?? 0) + (weekContribution ?? 0);
}

/**
 * Evaluate met-or-not against a target. `mode = "sticky"` means a `>=`
 * target stays met even if the value drops later in the window;
 * `"recompute"` means the value at this snapshot decides.
 */
function evalMet(value, target, mode) {
  if (target == null || target.value == null || value == null) return null;
  if (target.op === ">=") return value >= target.value;
  if (target.op === "<=") return value <= target.value;
  if (target.op === "=") return Math.abs(value - target.value) < 0.01 * Math.abs(target.value);
  return null;
}

/**
 * For cumulative-style targets: are we tracking ahead or behind the
 * pace needed to hit the cycle's target? Simple linear pace based on
 * "fraction of window elapsed vs fraction of target hit".
 */
function evalOnPace(cumulative, target, ctx) {
  if (target == null || target.value == null || cumulative == null) return null;
  if (target.op !== ">=") return null;
  const fracElapsed = elapsedFractionOfWindow(ctx);
  if (fracElapsed == null) return null;
  const fracHit = cumulative / target.value;
  // Allow a 10% buffer so a slow week early in the cycle doesn't read
  // as "behind".
  return fracHit + 0.1 >= fracElapsed;
}

function elapsedFractionOfWindow(ctx) {
  // Approximation — caller could pass a more precise window start.
  // For now, use cycle-start (year start) as the anchor when computing
  // fraction-elapsed for yearly/quarterly cadences.
  const yearStart = new Date(
    Date.UTC(ctx.weekEnd.getUTCFullYear(), 0, 1),
  ).getTime();
  const yearEnd = new Date(
    Date.UTC(ctx.weekEnd.getUTCFullYear() + 1, 0, 1),
  ).getTime();
  const span = yearEnd - yearStart;
  if (span <= 0) return null;
  return (ctx.weekEnd.getTime() - yearStart) / span;
}

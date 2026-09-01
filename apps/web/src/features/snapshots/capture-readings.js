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
  firstPassRatePct,
  linkagePct,
  medianTurnaroundDays,
} from "@/features/integrations";
import { weekNumber } from "@/lib/date";

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
 *   readLive?: (goalId: string) => object | null,
 *   //   Reader into the goal-tiers live-readings store — CI/CD and
 *   //   SCORECARD widgets' values only exist while their widget is
 *   //   mounted, so the CURRENT week's capture freezes what they last
 *   //   published. Omit for backfills: a past week must not be stamped
 *   //   with today's live value.
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
    case SPEC_KINDS.FIRST_PASS_RATE:
      return readFirstPass(spec, ctx);
    case SPEC_KINDS.CODE_RUBRIC:
      // Rubric grading is decoupled (PRs graded asynchronously). We
      // record the count of merged PRs in this window for context;
      // compliance-from-snapshots aggregates it.
      return readRubric(spec, ctx);
    // CI/CD + SCORECARD readings only exist while their widget is
    // mounted (they aggregate SWR sources this pure module can't
    // re-fetch) — freeze whatever the widget last published.
    case SPEC_KINDS.DEPLOY_FREQUENCY:
    case SPEC_KINDS.LEAD_TIME:
    case SPEC_KINDS.BUILD_PASS_RATE:
    case SPEC_KINDS.SCORECARD:
      return readFromLive(spec, goal, ctx);

    // ── Manual widgets ────────────────────────────────────────────────
    case SPEC_KINDS.COUNTER:
      return readCounter(spec, goal, ctx);
    case SPEC_KINDS.SCALE:
      return readScale(spec, goal, ctx);
    case SPEC_KINDS.MILESTONE:
      return readMilestone(spec, goal, ctx);
    case SPEC_KINDS.RECURRING_MILESTONE:
      return readRecurringMilestone(spec, goal, ctx);
    case SPEC_KINDS.DATE_LOG:
      return readDateLog(spec, goal, ctx);
    case SPEC_KINDS.FREE_TEXT:
    // COMPOSED + INCIDENT_LOG piggy-back on the goal-inputs store the
    // same way FREE_TEXT does — one entry per fill/incident — so the
    // "entries this week + total so far" reading is the right shape
    // for all three. (Period completion / severity judgement stays with
    // their own widgets; the snapshot stream just needs to EXIST.)
    case SPEC_KINDS.COMPOSED:
    case SPEC_KINDS.INCIDENT_LOG:
      return readFreeText(spec, goal, ctx);
    case SPEC_KINDS.BEFORE_AFTER:
      return readBeforeAfter(spec, goal, ctx);

    default:
      // Every member of SPEC_KINDS must be routed above (or explicitly
      // excluded with a comment) — capture-coverage.test.js enforces it.
      // A kind that silently lands here gets NO snapshot stream, ever:
      // compliance reads empty, evidence prints a placeholder, and the
      // deterministic grader has nothing to grade.
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
    onPace: evalOnPace(cumulative, target, ctx, resolveCadence(spec)),
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

function readFirstPass(spec, ctx) {
  const inWindow = mrsInWindow(ctx.mrs, ctx.weekStart, ctx.weekEnd);
  const result = firstPassRatePct(inWindow);
  const pct = result?.pct ?? null;
  const target = spec.source?.target;
  return baseReading(spec, ctx, {
    weekContribution: pct,
    cumulative: pct,
    windowMet: evalMet(pct, target, "recompute"),
  });
}

/**
 * Freeze the widget's last-published live reading (CI/CD + SCORECARD).
 * `ctx.readLive` is only supplied for the CURRENT week's capture — a
 * backfilled past week must not be stamped with today's live value, so
 * those record the window with nulls (the stream still exists, which is
 * the point). The envelope's `value` is the widget's DISPLAY string
 * ("87%", "3.2/wk"); we keep the leading number for trend surfaces but
 * never judge windowMet off it — display provenance isn't a measurement.
 */
function readFromLive(spec, goal, ctx) {
  const envelope =
    typeof ctx.readLive === "function" ? ctx.readLive(goal.id) : null;
  const value =
    envelope && (!envelope.widget || envelope.widget === spec.widget)
      ? leadingNumber(envelope.value)
      : null;
  return baseReading(spec, ctx, {
    weekContribution: null,
    cumulative: value,
    windowMet: null,
  });
}

function leadingNumber(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return null;
  const m = v.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
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
    onPace: evalOnPace(cumulative, target, ctx, resolveCadence(spec)),
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
  // The spec's own target decides "met" when it has one ("maintain 4.5+"
  // is a different bar than "reach 3"); the 4-on-a-1-5-scale heuristic is
  // only the fallback for target-less scales (audit #237 — the hardcode
  // ignored every authored target).
  const target = spec.manual?.target || spec.source?.target || null;
  return baseReading(spec, ctx, {
    weekContribution: value,
    cumulative: value,
    windowMet:
      value == null
        ? null
        : target
          ? evalMet(value, target, "recompute")
          : value >= 4,
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

function readRecurringMilestone(spec, goal, ctx) {
  // Entries are per-period checklist snapshots ({periodKey, items}) —
  // the latest one INSIDE this window is the period's state as of the
  // capture. Unlike MILESTONE (one lifetime checklist), completion here
  // is judged per window: an untouched period reads null, not carried
  // over from last period's 100%.
  const entries = ctx.allInputs[goal.id] || [];
  const inWindow = entries.filter(
    (e) => e.ts >= ctx.weekStart.getTime() && e.ts < ctx.weekEnd.getTime(),
  );
  const latest = inWindow[inWindow.length - 1];
  const items = Array.isArray(latest?.value?.items) ? latest.value.items : [];
  const done = items.filter((it) => it.done).length;
  const total = items.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : null;
  return baseReading(spec, ctx, {
    weekContribution: pct,
    cumulative: pct,
    windowMet: pct == null ? null : pct === 100,
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

/**
 * Which way is "better" for a BEFORE_AFTER goal — the ONE answer both
 * the snapshot capture and the evidence reading use. Before this the
 * two hardcoded OPPOSITE assumptions (snapshot: lower-is-better,
 * evidence: higher-is-better), so "reduce latency 800→400" exported as
 * *regressed* in the review document while the snapshot called it met
 * (audit #237).
 *
 * Resolution order:
 *   1. An authored target op is explicit intent: "<=" → lower, ">=" → higher.
 *   2. Directional verbs in the spec/goal text ("reduce…" vs "increase…").
 *   3. Default lower-is-better — the shipped majority is "reduce X"
 *      (response time, error rate, bundle size).
 */
export function beforeAfterDirection(spec, goal) {
  const op = spec?.manual?.target?.op || spec?.source?.target?.op || null;
  if (op === "<=") return "lower";
  if (op === ">=") return "higher";
  const text = [spec?.title, goal?.title, goal?.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/\b(reduce|decrease|lower|cut|shrink|minimi[sz]e|below|fewer)\b/.test(text)) {
    return "lower";
  }
  if (/\b(increase|raise|grow|boost|above|maximi[sz]e|expand)\b/.test(text)) {
    return "higher";
  }
  return "lower";
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
  const improved =
    beforeAfterDirection(spec, goal) === "lower" ? delta < 0 : delta > 0;
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
/** The one cadence resolution — baseReading and the pace math must
 *  never disagree on which window a goal lives in. */
function resolveCadence(spec) {
  return spec.manual?.cadence || inferCadenceFromSource(spec) || "weekly";
}

function baseReading(spec, ctx, fields) {
  const cadence = resolveCadence(spec);
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
  // LOCAL calendar components throughout: weekStart/weekEnd are local
  // midnights, and reading them back through getUTC* shifted the date
  // one day earlier for any timezone ahead of UTC (Cairo: a snapshot
  // for the week ending Fri Aug 1 00:00 local keyed to July). The week
  // number comes from lib/date's canonical Sunday-anchored counter —
  // the old private `sunWeekNumber` here used fixed 7-day blocks from
  // Jan 1 and disagreed with `weekLabel` by one most years, so one
  // snapshot carried two different week numberings.
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
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
      const wk = weekNumber(d);
      const fortnight = Math.ceil(wk / 2);
      return `${year}-F${String(fortnight).padStart(2, "0")}`;
    }
    case "weekly":
      return `W${String(weekNumber(d)).padStart(2, "0")}-${year}`;
    case "daily":
      return `${year}-${String(month).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    default:
      return "lifetime";
  }
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
function evalOnPace(cumulative, target, ctx, cadence) {
  if (target == null || target.value == null || cumulative == null) return null;
  if (target.op !== ">=") return null;
  const fracElapsed = elapsedFractionOfWindow(ctx, cadence);
  if (fracElapsed == null) return null;
  const fracHit = cumulative / target.value;
  // Allow a 10% buffer so a slow week early in the cycle doesn't read
  // as "behind".
  return fracHit + 0.1 >= fracElapsed;
}

/**
 * Fraction of the goal's OWN cadence window that has elapsed — the pace
 * denominator. Dividing by the calendar year regardless of cadence
 * (audit #237) told every quarterly goal it was "behind" for the first
 * weeks of each quarter: two weeks into Q3, a quarterly target's honest
 * fraction is ~0.15 of the quarter, not ~0.55 of the year. Local
 * calendar components throughout, matching `cadenceWindowFor`.
 */
function elapsedFractionOfWindow(ctx, cadence) {
  const d = ctx.weekEnd instanceof Date ? ctx.weekEnd : new Date(ctx.weekEnd);
  const year = d.getFullYear();
  const month = d.getMonth();
  let start;
  let end;
  switch (cadence) {
    case "quarterly": {
      const q0 = Math.floor(month / 3) * 3;
      start = new Date(year, q0, 1).getTime();
      end = new Date(year, q0 + 3, 1).getTime();
      break;
    }
    case "monthly":
      start = new Date(year, month, 1).getTime();
      end = new Date(year, month + 1, 1).getTime();
      break;
    case "weekly":
    case "biweekly":
    case "daily":
      // The capture window IS the cadence window (or a slice of it) —
      // measured at week end the window is effectively complete, and
      // sticky-met already handles early hits.
      start = ctx.weekStart.getTime();
      end = ctx.weekEnd.getTime();
      break;
    default:
      // yearly + cadence-less fall back to the calendar year (the old
      // behaviour, correct for exactly this case).
      start = new Date(year, 0, 1).getTime();
      end = new Date(year + 1, 0, 1).getTime();
  }
  const span = end - start;
  if (span <= 0) return null;
  return Math.min(1, Math.max(0, (d.getTime() - start) / span));
}

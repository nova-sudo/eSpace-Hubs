"use client";

/**
 * Per-goal evidence readings.
 *
 * Distills each classified goal into a compact `{ value, statusTone,
 * statusLabel }` triple suitable for the Evidence document's "Goal
 * tracking" section. Independent of any widget — the widgets compute
 * the same numbers for live rendering, this module computes them for
 * a static performance-review snapshot.
 *
 * Usage:
 *   const readings = useGoalReadings(); // [{ goal, spec, reading }]
 *
 * Layered cleanly:
 *   - `summarizeGoal(spec, goal, ctx)` is a pure function (no React)
 *   - `useGoalReadings()` is the React binding that gathers ctx
 *   - markdown-export consumes the readings; document-preview renders them
 */

import { useMemo } from "react";
import {
  avgReviewerComments,
  countMrComments,
  fmtDurationHours,
  firstPassRatePct,
  linkagePct,
  medianTurnaroundDays,
  mergedWithin,
  useCombinedEventsSince,
  useCombinedMergedSince,
  useJiraTickets,
} from "@/features/integrations";
import { useGoals } from "@/features/goals";
import { useGoalSpecs, SPEC_KINDS } from "@/features/goal-specs";
import {
  cadenceWindowLabel,
  computeCompliance,
  readInputs,
  useAllGoalInputs,
} from "@/features/goal-inputs";
import { goalCompliance, useSnapshots } from "@/features/snapshots";
import { readContextFor, useAllGoalContext } from "@/features/goal-context";
import { isoDaysAgo } from "@/lib/date";
import { rubricHash, readVerdict } from "@/features/grading";

/* ──────────────────────────── tones ──────────────────────────── */

const TONES = Object.freeze({
  OK: "ok",
  ACCENT: "accent",
  WARN: "warn",
  MUTED: "muted",
});

/* ────────────────────────── orchestrator hook ────────────────────────── */

/**
 * Returns a flat list of `{ goal, spec, reading }` for every classified
 * goal in the user's L1/L2 tree. Goals without a spec yet are skipped.
 *
 * Day window is 90d to match the rest of the evidence page; could be
 * parameterized later if the Date-range chips need to flow through.
 */
export function useGoalReadings(days = 90) {
  const { goals } = useGoals();
  const { specs } = useGoalSpecs();
  const { data: merged } = useCombinedMergedSince(isoDaysAgo(days));
  const { data: events } = useCombinedEventsSince(isoDaysAgo(days));
  const { data: jira } = useJiraTickets();
  const { snapshots } = useSnapshots();
  // Subscribe to the API-direct inputs + context stores. The memo below
  // reads readInputs() and readContextFor() synchronously, so it must
  // recompute when either store hydrates or changes — these ticks are
  // the dep that drives that. Mounting them also triggers their one-shot
  // hydration on session establishment.
  const inputsTick = useAllGoalInputs();
  const contextTick = useAllGoalContext();

  return useMemo(() => {
    const out = [];
    const allInputs = readInputs();
    const mrs = mergedWithin(merged || [], days);
    const tickets = Array.isArray(jira?.issues) ? jira.issues : [];

    const ctxBase = {
      specs,
      mrs,
      events,
      tickets,
      allInputs,
      snapshots,
    };

    for (const l1 of goals.l1s) {
      // Add the L1 itself (if classified) followed by its L2s — keeps the
      // tree shape readable in the rendered document.
      pushReading(out, l1, "L1", ctxBase);
      for (const l2 of l1.l2s) {
        pushReading(out, l2, "L2", { ...ctxBase, parentL1: l1 });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goals, specs, merged, events, jira, snapshots, days, inputsTick, contextTick]);
}

function pushReading(out, goal, level, ctx) {
  const spec = ctx.specs.get?.(goal.id) || ctx.specs[goal.id];
  if (!spec) return;
  // Snapshot-stream compliance — the canonical "performance over time"
  // read for cadence-window goals. Threaded into the per-widget reader
  // so it can prefer compliance over a single in-window snapshot.
  const compliance = goalCompliance(ctx.snapshots || [], goal.id);
  const ctxWithCompliance = { ...ctx, compliance };
  out.push({
    goal,
    spec,
    level,
    parentL1: ctx.parentL1 || null,
    reading: summarizeGoal(spec, goal, ctxWithCompliance),
    compliance,
  });
}

/**
 * Promote snapshot compliance to the headline reading when it's
 * available — applies to every auto widget that has a compliance
 * shape. Returns null when there's no compliance to surface (callers
 * should fall through to their default per-widget logic).
 */
function readingFromCompliance(spec, ctx) {
  const c = ctx.compliance;
  if (!c || c.pct == null) return null;
  const tone =
    c.pct >= 90 ? TONES.OK : c.pct >= 75 ? TONES.ACCENT : TONES.WARN;
  const label =
    c.pct >= 90 ? "on target" : c.pct >= 75 ? "drifting" : "below";
  const cadenceLabel = c.cadence === "weekly" ? "weeks" : c.cadence === "monthly" ? "months" : c.cadence === "quarterly" ? "quarters" : "windows";
  return {
    value: `${c.pct}% · ${c.metWindows} of ${c.totalWindows} ${cadenceLabel} on target`,
    statusTone: tone,
    statusLabel: label,
  };
}

/* ──────────────────────── pure summarizer ──────────────────────── */

/**
 * Deterministic, render-free summary of one goal. Looks at the spec's
 * widget kind and computes the headline figure + a coarse status tone.
 *
 * @param {object} spec  GoalSpec from `goal-specs`
 * @param {object} goal  L1 or L2 from `goals-store`
 * @param {object} ctx   { mrs, events, tickets, allInputs }
 */
export function summarizeGoal(spec, goal, ctx) {
  // Delegated wins over everything — the user explicitly handed off
  // tracking to a manager. Surface this clearly in the document.
  if (spec?.delegated?.delegated) {
    const judge = spec.delegated.judge || "manager";
    return {
      value: `Judged by ${judge}`,
      statusTone: TONES.MUTED,
      statusLabel: "delegated",
    };
  }

  // Phase A: explicitly untrackable. Show the reason as the achieved
  // value so the export carries the user's rationale.
  if (spec?.untrackable?.reason) {
    return {
      value: spec.untrackable.reason,
      statusTone: TONES.MUTED,
      statusLabel: "untrackable",
    };
  }

  switch (spec.widget) {
    case SPEC_KINDS.MERGED_COUNT:
      return readMergedCount(spec, ctx);
    case SPEC_KINDS.REVIEW_ROUNDS:
      return readReviewRounds(spec, ctx);
    case SPEC_KINDS.TURNAROUND:
      return readTurnaround(spec, ctx);
    case SPEC_KINDS.LINKAGE:
      return readLinkage(spec, ctx);
    case SPEC_KINDS.TICKET_CYCLE:
      return readTicketCycle(spec, ctx);
    case SPEC_KINDS.CODE_RUBRIC:
      return readCodeRubric(spec, goal, ctx);
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
    // Phase D2: % of merged PRs with ≤ 1 reviewer comment.
    case SPEC_KINDS.FIRST_PASS_RATE:
      return readFirstPassRate(spec, ctx);
    // Phase D1: per-incident logger + period-resetting checklist.
    case SPEC_KINDS.INCIDENT_LOG:
      return readIncidentLog(spec, goal, ctx);
    case SPEC_KINDS.RECURRING_MILESTONE:
      return readRecurringMilestone(spec, goal, ctx);
    // Phase D3: CI/CD widgets. No live build-events in the evidence
    // ctx (the resolver doesn't fetch Jenkins / GH Actions), so we
    // prefer snapshot compliance when available and otherwise
    // surface a "needs scope / tracked via dashboard" placeholder.
    case SPEC_KINDS.DEPLOY_FREQUENCY:
    case SPEC_KINDS.LEAD_TIME:
    case SPEC_KINDS.BUILD_PASS_RATE:
      return readCiCdFromCompliance(spec, ctx);
    // Phase E: composite. Aggregate score from snapshot compliance
    // when available; otherwise show component count + a hint.
    case SPEC_KINDS.SCORECARD:
      return readScorecard(spec, ctx);
    default:
      return { value: "—", statusTone: TONES.MUTED, statusLabel: "unknown" };
  }
}

/* ────────── auto readings ────────── */

function readMergedCount(spec, ctx) {
  // Prefer snapshot-stream compliance over an in-window count — it
  // reads more honestly for "did you sustain the bar?" reviews.
  const fromCompliance = readingFromCompliance(spec, ctx);
  if (fromCompliance) return fromCompliance;
  const count = ctx.mrs.length;
  return withTarget(count, spec.source?.target, `${count} merged`);
}

function readReviewRounds(spec, ctx) {
  const fromCompliance = readingFromCompliance(spec, ctx);
  if (fromCompliance) return fromCompliance;
  const avg = avgReviewerComments(ctx.mrs);
  if (avg == null) return empty();
  return withTarget(avg, spec.source?.target, `${avg.toFixed(1)} avg`, {
    lowerIsBetter: true,
  });
}

function readTurnaround(spec, ctx) {
  const fromCompliance = readingFromCompliance(spec, ctx);
  if (fromCompliance) return fromCompliance;
  const median = medianTurnaroundDays(ctx.mrs);
  if (median == null) return empty();
  const value = fmtDurationHours(median);
  return { value, statusTone: TONES.ACCENT, statusLabel: "tracked" };
}

function readLinkage(spec, ctx) {
  const fromCompliance = readingFromCompliance(spec, ctx);
  if (fromCompliance) return fromCompliance;
  const result = linkagePct(ctx.mrs);
  if (!result) return empty();
  const pct = result.pct ?? 0;
  return withTarget(pct, spec.source?.target, `${pct}% linked`);
}

function readTicketCycle(_spec, { tickets }) {
  if (!tickets.length) return empty();
  return {
    value: `${tickets.length} tickets`,
    statusTone: TONES.MUTED,
    statusLabel: "preview",
  };
}

function readCodeRubric(spec, goal, _ctx) {
  // Grading verdicts are cached per (prId, rubricHash). We don't re-fetch
  // PRs here — we report whatever's already in cache. If the user
  // hasn't pressed "Grade now" yet, this reads as "not graded".
  const answers = readContextFor(goal.id);
  const rubric = collectRubric(spec, answers);
  if (rubric.length === 0) {
    return {
      value: "Define rubric",
      statusTone: TONES.MUTED,
      statusLabel: "needs setup",
    };
  }
  // We don't have a PR list here without async fetching, so we fall
  // back to summarizing whatever's in the verdict cache for this rubric
  // by sampling a few representative PR ids if the user has graded.
  // For a static evidence doc, the simpler thing: count graded vs
  // pass/fail across whatever is cached.
  const sample = sampleVerdicts(rubric);
  if (sample.total === 0) {
    return {
      value: "Not graded yet",
      statusTone: TONES.MUTED,
      statusLabel: "no verdicts",
    };
  }
  const pct = Math.round((sample.pass / sample.total) * 100);
  return {
    value: `${pct}% pass · ${sample.pass}/${sample.total}`,
    statusTone:
      pct >= 90 ? TONES.OK : pct >= 75 ? TONES.ACCENT : TONES.WARN,
    statusLabel: pct >= 90 ? "on target" : pct >= 75 ? "drifting" : "below",
  };
}

function collectRubric(spec, answers) {
  if (!spec?.context?.questions || !answers) return [];
  const seen = new Set();
  const out = [];
  for (const q of spec.context.questions) {
    if (q.kind !== "list") continue;
    const ans = answers[q.id];
    if (!Array.isArray(ans)) continue;
    for (const raw of ans) {
      const v = typeof raw === "string" ? raw.trim() : "";
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/**
 * Walk the grading store's localStorage entries and tally pass/fail
 * for verdicts whose rubricHash matches the current rubric. Read-only.
 */
function sampleVerdicts(rubric) {
  if (typeof window === "undefined") return { pass: 0, fail: 0, total: 0 };
  const hash = rubricHash(rubric);
  // The grading store is a flat map; we fish out our entries by suffix.
  let raw;
  try {
    raw = JSON.parse(localStorage.getItem("espace-devhub:grading") || "{}");
  } catch {
    raw = {};
  }
  let pass = 0;
  let fail = 0;
  for (const [key, entry] of Object.entries(raw)) {
    if (!key.endsWith(`::${hash}`)) continue;
    if (entry?.verdict?.errored) continue;
    if (entry?.verdict?.pass) pass += 1;
    else fail += 1;
  }
  // Suppress unused param warning — we already have `hash` from rubric
  // closure but reading the verdict map by direct lookup would require
  // PR ids; we don't have them here. Fall back to the namespaced sweep.
  void readVerdict;
  return { pass, fail, total: pass + fail };
}

/* ────────── manual readings ────────── */

function readCounter(spec, goal, { allInputs }) {
  const entries = allInputs[goal.id] || [];
  const total = entries.reduce((s, e) => {
    const n = Number(e?.value);
    return Number.isFinite(n) ? s + n : s;
  }, 0);
  const cadence = spec.manual?.cadence || "weekly";
  const target = spec.manual?.target;
  const unit = spec.manual?.unit || "";

  // Compliance-first reading — matches what the live widget shows.
  // When compliance can't be computed (no target, non-bucketable cadence,
  // no entries) fall through to the legacy lifetime-total reading so we
  // don't drop the goal off the export entirely.
  const compliance = computeCompliance(entries, target, cadence);
  if (compliance) {
    const [singular, plural] = cadenceWindowLabel(compliance.cadence);
    const noun = compliance.totalWindows === 1 ? singular : plural;
    const tone =
      compliance.pct >= 90
        ? TONES.OK
        : compliance.pct >= 75
          ? TONES.ACCENT
          : TONES.WARN;
    const label =
      compliance.pct >= 90
        ? "on target"
        : compliance.pct >= 75
          ? "drifting"
          : "below";
    return {
      value: `${compliance.pct}% · ${compliance.metWindows} of ${compliance.totalWindows} ${noun} at target · Σ ${total} ${unit || "logged"}`,
      statusTone: tone,
      statusLabel: label,
    };
  }

  return withTarget(
    total,
    spec.manual?.target,
    `${total} ${unit || "logged"}`,
    { suffix: ` (${cadence})` },
  );
}

function readScale(_spec, goal, { allInputs }) {
  const entries = allInputs[goal.id] || [];
  const numeric = entries
    .map((e) => Number(e?.value))
    .filter((n) => Number.isFinite(n));
  if (numeric.length === 0) return empty("Not rated yet");
  const avg = numeric.reduce((s, n) => s + n, 0) / numeric.length;
  return {
    value: `${avg.toFixed(1)} avg · ${numeric.length} ratings`,
    statusTone:
      avg >= 4 ? TONES.OK : avg >= 3 ? TONES.ACCENT : TONES.WARN,
    statusLabel: avg >= 4 ? "strong" : avg >= 3 ? "tracking" : "weak",
  };
}

function readMilestone(_spec, goal, { allInputs }) {
  // Milestone widget stores `{ items: [...] }` snapshots; latest entry
  // wins.
  const entries = allInputs[goal.id] || [];
  const latest = entries[entries.length - 1];
  const items = Array.isArray(latest?.value?.items) ? latest.value.items : [];
  if (items.length === 0) return empty("No milestones");
  const done = items.filter((it) => it.done).length;
  const pct = Math.round((done / items.length) * 100);
  return {
    value: `${done} of ${items.length} done · ${pct}%`,
    statusTone:
      pct === 100 ? TONES.OK : pct >= 50 ? TONES.ACCENT : TONES.MUTED,
    statusLabel: pct === 100 ? "complete" : pct >= 50 ? "in progress" : "early",
  };
}

function readDateLog(_spec, goal, { allInputs }) {
  const entries = allInputs[goal.id] || [];
  if (entries.length === 0) return empty();
  return {
    value: `${entries.length} logged`,
    statusTone: TONES.ACCENT,
    statusLabel: "tracked",
  };
}

function readFreeText(_spec, goal, { allInputs }) {
  const entries = allInputs[goal.id] || [];
  if (entries.length === 0) return empty("No entries");
  return {
    value: `${entries.length} entries`,
    statusTone: TONES.ACCENT,
    statusLabel: "tracked",
  };
}

function readBeforeAfter(_spec, goal, { allInputs }) {
  const entries = allInputs[goal.id] || [];
  const latest = entries[entries.length - 1]?.value;
  const baseline = latest?.baseline;
  const current = latest?.current;
  if (baseline == null || current == null) {
    return empty("No baseline yet");
  }
  const delta = Number(current) - Number(baseline);
  const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
  return {
    value: `${baseline} → ${current} (${arrow} ${Math.abs(delta).toFixed(1)})`,
    statusTone: delta > 0 ? TONES.OK : delta < 0 ? TONES.WARN : TONES.MUTED,
    statusLabel: delta > 0 ? "improved" : delta < 0 ? "regressed" : "flat",
  };
}

/* ────────── Phase D2 / D3 / E readings ────────── */

/**
 * FIRST_PASS_RATE — % of merged PRs going through with ≤ 1 reviewer
 * comment. Prefers snapshot-stream compliance over an in-window
 * read, same as the other auto-from-MR widgets.
 */
function readFirstPassRate(spec, ctx) {
  const fromCompliance = readingFromCompliance(spec, ctx);
  if (fromCompliance) return fromCompliance;
  const result = firstPassRatePct(ctx.mrs);
  if (!result) return empty();
  const pct = result.pct ?? 0;
  return withTarget(pct, spec.source?.target, `${pct}% clean`);
}

/**
 * INCIDENT_LOG — per-incident logger. Reads from goal-inputs entries
 * with `{ severity, downtime, link? }` shape.
 *
 * Two modes (matches the widget — `inferIncidentMode` mirrors the
 * `inferMode` helper in incident-log-widget.jsx):
 *   - **Duration** (unit = "minutes" / time-words): headline value is
 *     Σ downtime, compared against `≤ N minutes / quarter` budgets.
 *   - **Count** (unit = "defects" / "incidents" / …): headline value
 *     is the entry count, compared against `≤ N defects / quarter`
 *     budgets — the natural reading for defect-control goals.
 */
function readIncidentLog(spec, goal, { allInputs }) {
  const entries = allInputs[goal.id] || [];
  if (entries.length === 0) return empty("No incidents logged");
  let totalDowntime = 0;
  for (const e of entries) {
    const d = Number(e?.value?.downtime);
    if (Number.isFinite(d)) totalDowntime += d;
  }
  const target = spec.manual?.target;
  const unit = spec.manual?.unit || "minutes";
  const period = target?.period || spec.manual?.cadence;
  const periodSuffix = period ? ` / ${period}` : "";
  const isCountMode = inferIncidentMode(unit) === "count";
  // The headline value is what the target compares against. Count mode
  // looks at entry count (so "Σ 10 defects · quarter" reads as
  // "defects in window"); duration mode looks at downtime minutes.
  const headlineValue = isCountMode ? entries.length : totalDowntime;
  const summary = isCountMode
    ? `${entries.length} ${unit}${
        totalDowntime > 0 ? ` · Σ ${totalDowntime}m downtime` : ""
      }`
    : `${entries.length} incidents · Σ ${totalDowntime} ${unit}`;
  if (!target || target.value == null) {
    return {
      value: summary,
      statusTone: TONES.ACCENT,
      statusLabel: "tracked",
    };
  }
  // Target is "≤ N [units] per period" — under = good, over = warn.
  return withTarget(
    headlineValue,
    target,
    `${summary}${periodSuffix}`,
    { lowerIsBetter: target.op === "<=" },
  );
}

/**
 * Local copy of the widget's `inferMode` — kept here so the evidence
 * resolver doesn't have to depend on the React widget bundle. If the
 * DURATION_UNITS list ever grows, sync both files.
 */
const INCIDENT_DURATION_UNITS = new Set([
  "minute",
  "minutes",
  "min",
  "mins",
  "m",
  "hour",
  "hours",
  "hr",
  "hrs",
  "h",
  "second",
  "seconds",
  "sec",
  "secs",
  "s",
]);

function inferIncidentMode(unit) {
  if (typeof unit !== "string") return "duration";
  const u = unit.toLowerCase().trim();
  if (INCIDENT_DURATION_UNITS.has(u)) return "duration";
  return "count";
}

/**
 * RECURRING_MILESTONE — checklist that resets each period. Reads the
 * MOST RECENT entry's items (current period's progress) and reports
 * "M of N done · pct%". Streak (consecutive complete periods) is a
 * dashboard nicety we don't recompute here — evidence wants the
 * latest snapshot, not the history.
 */
function readRecurringMilestone(_spec, goal, { allInputs }) {
  const entries = allInputs[goal.id] || [];
  const latest = entries[entries.length - 1];
  const items = Array.isArray(latest?.value?.items) ? latest.value.items : [];
  if (items.length === 0) return empty("No checklist yet");
  const done = items.filter((it) => it.done).length;
  const pct = Math.round((done / items.length) * 100);
  return {
    value: `${done} of ${items.length} done · ${pct}%`,
    statusTone:
      pct === 100 ? TONES.OK : pct >= 50 ? TONES.ACCENT : TONES.MUTED,
    statusLabel:
      pct === 100 ? "period complete" : pct >= 50 ? "in progress" : "early",
  };
}

/**
 * CI/CD widgets (DEPLOY_FREQUENCY / LEAD_TIME / BUILD_PASS_RATE).
 *
 * The evidence resolver doesn't fetch build events (no Jenkins /
 * GH Actions wiring here — that's the dashboard's job). So we try
 * snapshot-stream compliance first (captured by the dashboard
 * snapshotter when goal readings are taken) and otherwise show a
 * "tracked on dashboard" placeholder rather than a blank "—". The
 * value still appears in exports, just without a numeric headline.
 */
function readCiCdFromCompliance(spec, ctx) {
  const fromCompliance = readingFromCompliance(spec, ctx);
  if (fromCompliance) return fromCompliance;
  return {
    value: "Tracked via dashboard",
    statusTone: TONES.MUTED,
    statusLabel: "no snapshot yet",
  };
}

/**
 * SCORECARD — composite widget. We don't recompute its weighted
 * aggregate here (that would mean re-running every component's
 * resolution path), so we prefer the snapshot-stream compliance
 * recorded by the dashboard. Falling back to "N components" gives
 * the export something readable even when no snapshots exist.
 */
function readScorecard(spec, ctx) {
  const fromCompliance = readingFromCompliance(spec, ctx);
  if (fromCompliance) return fromCompliance;
  const n = Array.isArray(spec?.scorecard?.components)
    ? spec.scorecard.components.length
    : 0;
  if (n === 0) {
    return empty("Scorecard not configured");
  }
  return {
    value: `Scorecard · ${n} component${n === 1 ? "" : "s"}`,
    statusTone: TONES.MUTED,
    statusLabel: "tracked on dashboard",
  };
}

/* ────────── helpers ────────── */

/**
 * Build a reading with target evaluation. `withTarget(45, {op:">=",value:30}, "45 merged")`
 * returns { value, statusTone, statusLabel } based on whether the value meets the target.
 */
function withTarget(value, target, displayValue, opts = {}) {
  if (!target || target.value == null) {
    return {
      value: displayValue,
      statusTone: TONES.ACCENT,
      statusLabel: "tracked",
    };
  }
  let meets;
  if (target.op === ">=") meets = value >= target.value;
  else if (target.op === "<=") meets = value <= target.value;
  else if (target.op === "=") meets = Math.abs(value - target.value) < 0.01;
  else meets = null;
  const lowerBetter = !!opts.lowerIsBetter;
  return {
    value: displayValue + (opts.suffix || ""),
    statusTone:
      meets === true
        ? TONES.OK
        : meets === false
          ? TONES.WARN
          : TONES.ACCENT,
    statusLabel:
      meets === true
        ? "on target"
        : meets === false
          ? lowerBetter
            ? "drifting"
            : "below"
          : "tracked",
  };
}

function empty(value = "—") {
  return { value, statusTone: TONES.MUTED, statusLabel: "no data" };
}

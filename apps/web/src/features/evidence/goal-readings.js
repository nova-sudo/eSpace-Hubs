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

import { useMemo, useSyncExternalStore } from "react";
import {
  avgReviewerComments,
  countMrComments,
  fmtDurationHours,
  firstPassRatePct,
  linkagePct,
  medianTurnaroundDays,
  useCombinedEventsSince,
  useCombinedMergedSince,
  useJiraTickets,
} from "@/features/integrations";
import { useGoals } from "@/features/goals";
import { useGoalSpecs, SPEC_KINDS } from "@/features/goal-specs";
import {
  cadenceWindowLabel,
  computeCompliance,
  currentPeriodKey,
  readInputs,
  useAllGoalInputs,
} from "@/features/goal-inputs";
import { goalCompliance, useSnapshots } from "@/features/snapshots";
import { readContextFor, useAllGoalContext } from "@/features/goal-context";
import {
  readGoalLiveReading,
  subscribeGoalLiveReadings,
  getGoalLiveReadingsSnapshot,
  getGoalLiveReadingsServerSnapshot,
} from "@/features/goal-tiers";
import { startOfYearIso, startOfYearMs } from "@/lib/date";
import {
  inferIncidentMode,
  filterByPeriod,
  isDefectEntry,
  latestDeliverables,
  summarizeDefects,
  defectRatePct,
} from "@/lib/defects";
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
 * Window is year-to-date (Jan 1 → today). The Evidence page tracks the L2
 * *annual* goals, so a rolling 30/90-day slice would clip the very evidence
 * the review is about — every source reads from the start of the year.
 * (A trailing `days` arg from legacy call sites is accepted and ignored.)
 */
export function useGoalReadings() {
  const { goals } = useGoals();
  const { specs } = useGoalSpecs();
  const since = startOfYearIso();
  const { data: merged } = useCombinedMergedSince(since);
  const { data: events } = useCombinedEventsSince(since);
  const { data: jira } = useJiraTickets();
  const { snapshots } = useSnapshots();
  // Subscribe to the API-direct inputs + context stores. The memo below
  // reads readInputs() and readContextFor() synchronously, so it must
  // recompute when either store hydrates or changes — these ticks are
  // the dep that drives that. Mounting them also triggers their one-shot
  // hydration on session establishment.
  const inputsTick = useAllGoalInputs();
  const contextTick = useAllGoalContext();
  // Widgets publish their live reading to the goal-tiers live-readings store
  // (scorecard / CI-CD / rubric). Subscribe so the memo re-reads when a goal's
  // reading lands — this is what lets Evidence show the SAME value the Goals
  // tile showed, instead of a "tracked on dashboard" placeholder.
  const liveTick = useSyncExternalStore(
    subscribeGoalLiveReadings,
    getGoalLiveReadingsSnapshot,
    getGoalLiveReadingsServerSnapshot,
  );

  return useMemo(() => {
    const out = [];
    const allInputs = readInputs();
    // Year-to-date window: keep merges from Jan 1 onward. The combined hook
    // already fetches since the same cutoff; this client-side filter guards
    // against providers that page by `updated_after` rather than `merged_at`.
    const yearStart = startOfYearMs();
    const mrs = (merged || []).filter(
      (m) => m.merged_at && new Date(m.merged_at).getTime() >= yearStart,
    );
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
  }, [goals, specs, merged, events, jira, snapshots, inputsTick, contextTick, liveTick]);
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
    case SPEC_KINDS.COMPOSED:
      return readComposed(spec, goal, ctx);
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
  // Prefer the pass-rate the mounted rubric widget published (it graded the
  // live PR list) — the same "% pass · P/T" the Goals page shows.
  const live = fromLiveReading(spec);
  if (live) return live;
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
 * INCIDENT_LOG — per-incident / defect logger. Reads goal-inputs entries via
 * the shared lib/defects math the widget + grader also use, so all three agree.
 *
 * Two modes (see `inferIncidentMode`):
 *   - **Duration** (unit = "minutes" / time-words): headline is Σ downtime vs a
 *     `≤ N minutes / period` SLA budget.
 *   - **Defect / count** (unit = "defects" / "bugs" / …): show the RATE
 *     (defects ÷ deliverables) when a deliverables denominator is recorded —
 *     the "≤X%" defect-control goals are written in — else count vs budget.
 * All figures are windowed to the current cadence period, matching the tile.
 */
function readIncidentLog(spec, goal, { allInputs }) {
  const entries = allInputs[goal.id] || [];
  const target = spec.manual?.target;
  const unit = spec.manual?.unit || "minutes";
  const period = target?.period || spec.manual?.cadence;
  const periodSuffix = period ? ` / ${period}` : "";
  const isCountMode = inferIncidentMode(unit) === "count";
  // Window to the current cadence period so the reading matches the widget
  // (which resets its budget/rate each period).
  const windowed = filterByPeriod(entries, period);
  const defects = windowed.filter(isDefectEntry);

  const budgeted = target && target.value != null;

  // Duration mode (SLA downtime budget) — headline is Σ downtime vs budget.
  if (!isCountMode) {
    // Defer only when there's genuinely nothing to show. A budgeted goal with
    // zero in-window incidents is NOT "no data" — it's "0 within budget", a
    // passing reading that must match the tile + grader (finding: parity).
    if (defects.length === 0 && !budgeted) return empty("No incidents logged");
    const totalDowntime = defects.reduce((s, e) => {
      const d = Number(e?.value?.downtime);
      return Number.isFinite(d) ? s + d : s;
    }, 0);
    const summary = `${defects.length} incidents · Σ ${totalDowntime} ${unit}`;
    if (!budgeted) {
      return { value: summary, statusTone: TONES.ACCENT, statusLabel: "tracked" };
    }
    return withTarget(totalDowntime, target, `${summary}${periodSuffix}`, {
      lowerIsBetter: target.op === "<=",
    });
  }

  // Defect / count mode — show the RATE when deliverables are recorded (the
  // "≤X%" the goal is really about), else fall back to count vs budget.
  // Deliverables is a persistent scalar over ALL entries (never windowed).
  const deliverables = latestDeliverables(entries);
  const rate = defectRatePct(defects.length, deliverables);
  if (defects.length === 0 && deliverables == null) return empty(`No ${unit} logged`);

  if (rate != null) {
    const s = summarizeDefects(defects);
    const clean = defects.length === 0;
    const documented = clean || (s.fullyDocumented && s.preventiveOpen === 0);
    return {
      value: `${rate}% defect rate · ${defects.length}/${deliverables}${periodSuffix}`,
      statusTone: documented ? TONES.OK : TONES.ACCENT,
      statusLabel: clean ? "no defects" : documented ? "documented" : "tracked",
    };
  }

  const summary = `${defects.length} ${unit}`;
  if (!target || target.value == null) {
    return { value: summary, statusTone: TONES.ACCENT, statusLabel: "tracked" };
  }
  return withTarget(defects.length, target, `${summary}${periodSuffix}`, {
    lowerIsBetter: target.op === "<=",
  });
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
  const live = fromLiveReading(spec);
  if (live) return live;
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
  // The mounted scorecard widget publishes its composite {score,pass,total} —
  // read that (the "96%") instead of punting to "tracked on dashboard".
  const live = fromLiveReading(spec);
  if (live) return live;
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

/**
 * COMPOSED — the generative widget. No single scalar; summarize how much of the
 * current record is filled, mirroring EXACTLY what the ComposedWidget tile shows
 * so Evidence never diverges from the Goals page:
 *   - Current-period only: the widget renders currentPeriodKey(cadence, now) and
 *     filters entries to that period, so a quarterly goal filled last quarter
 *     but empty this one reads as empty here too — not "100%" from a stale
 *     prior-period entry. (Cadence-less goals share one running record: null.)
 *   - Denominator is ALL fields (the tile's "filled/total captured" counts every
 *     field, optional included) — a required-only base would report a different
 *     fraction than the widget for any goal with optional fields.
 * Pure — data is already in ctx.
 */
function readComposed(spec, goal, { allInputs }) {
  const fields = Array.isArray(spec.fields) ? spec.fields : [];
  if (fields.length === 0) return empty("Not started");

  const cadence = spec.composed?.cadence || null;
  const periodKey = currentPeriodKey(cadence, Date.now());
  const entries = allInputs[goal.id] || [];
  const matching = entries.filter((e) =>
    periodKey == null
      ? e?.value && e.value.periodKey == null
      : e?.value?.periodKey === periodKey,
  );
  const vals = matching[matching.length - 1]?.value?.values;
  const values = vals && typeof vals === "object" ? vals : {};

  const filled = fields.filter((f) => {
    const v = values[f.id];
    return f.kind === "checkbox" ? v === true : v != null && v !== "";
  }).length;
  const total = fields.length;
  const pct = total ? Math.round((filled / total) * 100) : 0;
  return {
    value: `${filled} of ${total} fields filled · ${pct}%`,
    statusTone: pct === 100 ? TONES.OK : pct > 0 ? TONES.ACCENT : TONES.MUTED,
    statusLabel: pct === 100 ? "complete" : pct > 0 ? "in progress" : "not started",
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

/**
 * Prefer the reading the mounted widget PUBLISHED (persisted in the goal-tiers
 * live-readings store) — the exact number the Goals page showed — over our
 * static recompute. This is how Evidence stops drifting for the composite /
 * live-only widgets it can't recompute headlessly (SCORECARD, CI/CD, rubric).
 * Guarded on `live.widget === spec.widget` so a stale reading left behind by a
 * reclassified goal can't hijack a differently-typed goal. Null when there's no
 * matching published reading (device never opened the Goals page this session).
 */
function fromLiveReading(spec) {
  const live = readGoalLiveReading(spec?.goalId);
  if (!live || live.widget !== spec?.widget) return null;
  // SCORECARD publishes {score,pass,total,...} — the tile's own numbers.
  if (live.widget === SPEC_KINDS.SCORECARD && Number.isFinite(live.score)) {
    const pct = Math.round(live.score);
    const onTgt =
      Number.isFinite(live.pass) && Number.isFinite(live.total)
        ? ` · ${live.pass}/${live.total} on target`
        : "";
    return {
      value: `${pct}%${onTgt}`,
      statusTone: pct >= 90 ? TONES.OK : pct >= 75 ? TONES.ACCENT : TONES.WARN,
      statusLabel: pct >= 90 ? "on target" : pct >= 75 ? "drifting" : "below",
    };
  }
  // CI/CD + rubric widgets publish the normalized {value,statusTone,statusLabel}.
  if (typeof live.value === "string" && live.statusLabel) {
    return {
      value: live.value,
      statusTone: live.statusTone || TONES.ACCENT,
      statusLabel: live.statusLabel,
    };
  }
  return null;
}

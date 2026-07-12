"use client";

/**
 * AI tier verdict for one goal.
 *
 * Reads the goal's classifier-distilled tiers (`spec.tiers`) + the
 * latest snapshot reading for the goal, grades once per day (cached in
 * goal-tier-store), and returns the current verdict reactively.
 *
 *   const { hasTiers, verdict, loading, regrade } = useGoalTier(goalId, spec);
 *   verdict = { tier: "not_achieved"|"achieved"|"over_achieved"|"role_model",
 *               reasoning, confidence } | null
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useSnapshots } from "@/features/snapshots";
import { useGoalInputs, getInputsState, currentPeriodKey } from "@/features/goal-inputs";
import { useGoalContext, useIsContextComplete } from "@/features/goal-context";
import { SPEC_KINDS } from "@/features/goal-specs";
import { getAiProvider } from "@/features/analyst";
import {
  gradeGoalTier,
  getGoalTiersServerSnapshot,
  getGoalTiersSnapshot,
  readGoalTier,
  setGoalTierVerdict,
  subscribeGoalTiers,
} from "./goal-tier-store";
import {
  getGoalLiveReadingsServerSnapshot,
  getGoalLiveReadingsSnapshot,
  readGoalLiveReading,
  subscribeGoalLiveReadings,
} from "./live-readings-store";
import { gradeNumericTier, numericReadingFor } from "./grade-numeric";
import {
  inferIncidentMode,
  filterByPeriod,
  isDefectEntry,
  latestDeliverables,
  summarizeDefects,
  defectRatePct,
  incidentHasCurrentData,
} from "@/lib/defects";

/** Shown when there's no usable reading yet — deferred, not "not achieved". */
const AWAITING_VERDICT = Object.freeze({
  tier: null,
  awaiting: true,
  reasoning: "Awaiting data — fill the check-in or connect the source.",
  confidence: "low",
});

/**
 * Shown while the goal still needs setup (context questions unanswered,
 * untrackable, or delegated). A not-ready goal can't be filled, so grading it
 * against whatever stale entries exist produced verdicts like "over achieved"
 * under a "define before tracking" form. Deferred until the user finishes
 * setup — the same readiness gate the widget resolver and check-in obey.
 */
const SETUP_VERDICT = Object.freeze({
  tier: null,
  awaiting: true,
  pendingSetup: true,
  reasoning: "Setup incomplete — finish defining this goal before it's graded.",
  confidence: "low",
});

/**
 * Readiness predicate, inlined rather than imported from
 * `@/features/goal-widgets` (goalReadiness): goal-widgets' barrel imports
 * this feature for the ladder/badge, so importing back would close an
 * ES-module cycle. Keep in sync with `goal-widgets/readiness.js`.
 */
function specNeedsSetup(spec, contextComplete) {
  if (!spec) return false; // no spec → hasTiers is false anyway
  if (spec.untrackable) return true;
  if (spec.delegated?.delegated) return true;
  return !!(spec.context?.required && !contextComplete);
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Most recent snapshot reading for a goal (snapshots are newest-first). */
function latestReadingFor(snapshots, goalId) {
  if (!Array.isArray(snapshots) || !goalId) return null;
  for (const s of snapshots) {
    const r = s?.goalReadings?.[goalId];
    if (r) return r;
  }
  return null;
}

/** Compact, model-friendly summary of a goal's current reading. */
function readingToText(reading) {
  if (!reading || typeof reading !== "object") return "";
  const bits = [];
  if (reading.cumulative != null) bits.push(`current value: ${reading.cumulative}`);
  if (reading.weekContribution != null)
    bits.push(`this period: ${reading.weekContribution}`);
  if (reading.target && reading.target.value != null) {
    bits.push(`target: ${reading.target.op || ""} ${reading.target.value}`.trim());
  }
  if (reading.windowMet != null)
    bits.push(`target met: ${reading.windowMet ? "yes" : "no"}`);
  if (reading.onPace != null) bits.push(`on pace: ${reading.onPace ? "yes" : "no"}`);
  if (reading.cadenceWindow) bits.push(`window: ${reading.cadenceWindow}`);
  return bits.join("; ");
}

/**
 * Build the "current data" the grader sees. For MANUAL-family widgets we
 * read the LIVE goal-inputs the widget itself renders (the latest entry),
 * so a 100%-complete milestone reads as 100% — not "(no data)" as it did
 * when we only passed the snapshot reading (which is empty for
 * recurring-milestone / incident / scorecard widgets). AUTO widgets fall
 * back to the snapshot reading (captureGoalReadings populates those).
 */
function buildCurrentData(spec, entries, reading, liveReading) {
  const widget = spec?.widget;
  const list = Array.isArray(entries) ? entries : [];
  const latest = list.length ? list[list.length - 1] : null;

  switch (widget) {
    // Composite widget — its component values (SWR sources, sub-goal inputs,
    // rubric verdicts) only exist inside the mounted widget, which publishes
    // them as a live reading. Grade on that; the snapshot reading is the
    // fallback for devices where the widget hasn't rendered yet.
    case SPEC_KINDS.SCORECARD:
      return liveScorecardToText(liveReading) || readingToText(reading);
    // One-time checklist — the latest entry IS the whole picture.
    case SPEC_KINDS.MILESTONE: {
      const items = Array.isArray(latest?.value?.items) ? latest.value.items : [];
      if (items.length === 0) return readingToText(reading);
      const done = items.filter((it) => it && it.done).length;
      const total = items.length;
      const pct = Math.round((done / total) * 100);
      const open = items
        .filter((it) => it && !it.done)
        .map((it) => it.label)
        .filter(Boolean);
      const evidence = evidenceLines(items);
      return [
        `${done}/${total} checklist items complete (${pct}%)`,
        open.length
          ? `incomplete: ${open.slice(0, 8).join("; ")}`
          : "all items complete",
        evidence ? `evidence provided — ${evidence}` : "no evidence attached",
      ].join("; ");
    }
    // Period-resetting checklist — tiers like "all items EVERY quarter" need
    // the WHOLE history, not just the current period. Summarise every tracked
    // period + the streak so the grader can actually evaluate "every period".
    case SPEC_KINDS.RECURRING_MILESTONE: {
      const summary = recurringMilestoneSummary(list);
      if (!summary) return readingToText(reading);
      const perPeriod = summary.rows
        .map(
          (r) =>
            `${r.pk}: ${r.done}/${r.total} ${
              r.complete
                ? "complete"
                : `INCOMPLETE${r.open.length ? ` (missing: ${r.open.slice(0, 6).join(", ")})` : ""}`
            }`,
        )
        .join("; ");
      const evidence = summary.rows
        .filter((r) => r.evidence)
        .map((r) => `${r.pk} — ${r.evidence}`)
        .join(" | ");
      return [
        `${summary.total} period(s) tracked — ${perPeriod}`,
        `${summary.completeCount} of ${summary.total} period(s) fully complete`,
        `current streak of consecutive complete periods: ${summary.streak}`,
        summary.firstIncomplete
          ? `earliest incomplete period: ${summary.firstIncomplete.pk} (so NOT every tracked period is complete)`
          : "every tracked period is complete",
        evidence
          ? `evidence provided — ${evidence}`
          : "no evidence attached to any period",
      ].join(". ");
    }
    // The generative widget — serialize its declarative field schema +
    // captured values + per-field evidence. Period-resetting COMPOSED goals
    // are graded across EVERY submitted period (each is one cycle of the
    // goal), not just the current calendar period — so a fully-documented Q1
    // counts even while the current quarter is still empty.
    case SPEC_KINDS.COMPOSED: {
      const fields = Array.isArray(spec.fields) ? spec.fields : [];
      if (fields.length === 0) return readingToText(reading);
      const curKey = currentPeriodKey(spec.composed?.cadence, Date.now());

      // Latest record per period (entries are ts-ascending → last write wins).
      const byPeriod = new Map();
      for (const e of list) {
        const v = e?.value;
        if (!v || typeof v !== "object") continue;
        byPeriod.set(v.periodKey ?? "__single__", v);
      }
      if (byPeriod.size === 0) return readingToText(reading);

      const required = fields.filter((f) => !f.optional);
      const recComplete = (rec) => {
        const vals = rec?.values && typeof rec.values === "object" ? rec.values : {};
        return (
          required.length > 0 &&
          required.every((f) => {
            const v = vals[f.id];
            return f.kind === "checkbox" ? v === true : v != null && v !== "";
          })
        );
      };
      const renderPeriod = (pk, rec) => {
        const vals = rec?.values && typeof rec.values === "object" ? rec.values : {};
        const ev = rec?.evidence && typeof rec.evidence === "object" ? rec.evidence : {};
        const filled = fields.filter((f) => {
          const v = vals[f.id];
          return f.kind === "checkbox" ? v === true : v != null && v !== "";
        }).length;
        const lines = fields.map((f) => {
          const v = vals[f.id];
          const blank = v == null || v === "";
          const shown = blank
            ? "—"
            : f.kind === "checkbox"
              ? v
                ? "yes"
                : "no"
              : `${v}${f.unit ? ` ${f.unit}` : ""}`;
          const proof = ev[f.id] ? ` [evidence: ${ev[f.id]}]` : "";
          return `${f.label}: ${shown}${proof}`;
        });
        const tag =
          pk === "__single__" ? "record" : `${pk}${pk === curKey ? " (current period)" : ""}`;
        return `• ${tag} — ${filled}/${fields.length} fields, ${
          recComplete(rec) ? "COMPLETE" : "incomplete"
        }: ${lines.join("; ")}`;
      };

      // Newest period first; cap to bound the prompt for high-frequency
      // cadences (weekly/daily). Quarterly/monthly fit comfortably.
      const CAP = 8;
      const keys = [...byPeriod.keys()].sort().reverse();
      const blocks = keys.slice(0, CAP).map((pk) => renderPeriod(pk, byPeriod.get(pk)));
      const completeCount = keys.filter((pk) => recComplete(byPeriod.get(pk))).length;
      let streak = 0;
      for (const pk of keys) {
        if (recComplete(byPeriod.get(pk))) streak += 1;
        else break;
      }

      const head =
        `composed widget — ${byPeriod.size} period(s) submitted, ${completeCount} fully complete; ` +
        `streak of consecutive complete periods (newest back): ${streak}. ` +
        `Judge the achievement tier across ALL submitted periods below. Tiers that describe ` +
        `a single cycle (e.g. "achieved") are met when the most recent SUBMITTED period satisfies ` +
        `them — ignore not-yet-started future periods. Tiers that say "every period" require ALL ` +
        `submitted periods to satisfy them.` +
        (keys.length > CAP ? ` Showing the ${CAP} most recent of ${keys.length} periods.` : "");
      return [head, ...blocks].join("\n");
    }
    case SPEC_KINDS.COUNTER: {
      const sum = list.reduce((s, e) => s + (Number(e?.value) || 0), 0);
      return `current total: ${sum}`;
    }
    case SPEC_KINDS.SCALE: {
      const v =
        latest && Number.isFinite(Number(latest.value))
          ? Number(latest.value)
          : null;
      return v == null ? readingToText(reading) : `latest rating: ${v} of 5`;
    }
    case SPEC_KINDS.DATE_LOG:
      return `${list.length} entries logged`;
    case SPEC_KINDS.INCIDENT_LOG: {
      const unit = spec.manual?.unit || "minutes";
      const target = spec.manual?.target;
      const period = target?.period || spec.manual?.cadence;
      const windowed = filterByPeriod(list, period);
      const defects = windowed.filter(isDefectEntry);

      // Duration mode (SLA downtime budget) — keep the lean downtime summary.
      if (inferIncidentMode(unit) !== "count") {
        const downtime = defects.reduce(
          (s, e) => s + (Number(e.value?.downtime) || 0),
          0,
        );
        const budget = target?.value;
        return [
          `${defects.length} incident(s) logged${period ? ` this ${period}` : ""}`,
          downtime ? `total downtime ${downtime} min` : "no downtime recorded",
          Number.isFinite(budget)
            ? `budget ${target.op || "<="} ${budget} ${unit}${period ? ` / ${period}` : ""} — ${downtime <= budget ? "within" : "OVER"} budget`
            : null,
        ]
          .filter(Boolean)
          .join("; ");
      }

      // Defect / count mode — emit the RATE, severity split, per-defect
      // documentation coverage, and preventive-action status, so the grader
      // can actually judge "≤X% AND documented AND preventive closed" criteria
      // instead of defaulting to "not achieved" for want of a rate. Deliverables
      // is a persistent scalar over ALL entries (not windowed) so it can't age
      // out from under the defects it divides.
      const deliverables = latestDeliverables(list);
      const s = summarizeDefects(defects);
      const rate = defectRatePct(defects.length, deliverables);
      if (defects.length === 0 && deliverables == null) {
        // Nothing in the current window and no denominator. This exactly mirrors
        // !incidentHasCurrentData, so hasAnyData is false and the effect defers
        // to AWAITING — this string is only the cache-key basis, never graded.
        return `no ${unit} logged${period ? ` this ${period}` : ""} and no deliverables recorded — nothing to grade yet`;
      }
      const lines = [
        rate != null
          ? `defect rate: ${defects.length} ${unit} / ${deliverables} deliverables = ${rate}%${period ? ` this ${period}` : ""}`
          : `${defects.length} ${unit} logged${period ? ` this ${period}` : ""}; deliverables not recorded, so a defect RATE cannot be computed (assume the count is the whole picture)`,
      ];
      const budget = target?.value;
      if (Number.isFinite(budget)) {
        lines.push(
          `count vs budget: ${defects.length} of ${target.op || "<="} ${budget} ${unit}${period ? ` / ${period}` : ""}`,
        );
      }
      lines.push(
        `severity: ${s.major} major/critical (P1/P2), ${s.minor} minor (P3/P4)`,
      );
      lines.push(
        defects.length > 0
          ? `documentation: ${s.withRca}/${defects.length} have a documented root-cause analysis, ${s.withAction}/${defects.length} have a corrective/preventive action${s.fullyDocumented ? " — every defect is fully documented" : ""}`
          : "documentation: n/a (no defects this period)",
      );
      lines.push(
        defects.length > 0
          ? `preventive actions: ${s.preventiveClosed} closed, ${s.preventiveOpen} still open`
          : "preventive actions: none needed",
      );
      const CAP = 10;
      const detail = defects
        .slice(-CAP)
        .reverse()
        .map((e) => {
          const v = e.value || {};
          const rcaText = v.rca || v.link;
          return `• ${v.severity || "?"}${Number.isFinite(v.downtime) ? ` ${v.downtime}m` : ""} — root cause: ${rcaText ? "yes" : "no"}, action: ${v.action ? "yes" : "no"}, preventive: ${v.preventive || "—"}`;
        });
      if (detail.length) {
        lines.push("per-defect:", ...detail);
      }
      return lines.join("\n");
    }
    case SPEC_KINDS.BEFORE_AFTER: {
      const b = Number(latest?.value?.baseline);
      const c = Number(latest?.value?.current);
      if (!Number.isFinite(b) && !Number.isFinite(c)) return readingToText(reading);
      return `baseline ${Number.isFinite(b) ? b : "?"} → current ${Number.isFinite(c) ? c : "?"}`;
    }
    case SPEC_KINDS.FREE_TEXT:
      return `${list.length} reflection note(s) logged`;
    default:
      // AUTO widgets (merged/turnaround/linkage/…), CODE_RUBRIC, SCORECARD:
      // the snapshot reading is the right current-data source.
      return readingToText(reading);
  }
}

/**
 * Serialize a SCORECARD's published live reading into grader-friendly prose:
 * the composite score plus one line per component (value, target, score,
 * weight). Empty string when nothing was published yet.
 */
function liveScorecardToText(live) {
  if (!live || typeof live !== "object") return "";
  const bits = [];
  if (Number.isFinite(live.score)) {
    bits.push(
      `composite score: ${live.score}%${live.aggregate ? ` (${live.aggregate})` : ""}`,
    );
  }
  if (Number.isFinite(live.pass) && Number.isFinite(live.total) && live.total > 0) {
    bits.push(`${live.pass}/${live.total} components on target`);
  }
  const comps = Array.isArray(live.components) ? live.components : [];
  const lines = comps.map((c) => {
    const parts = [
      `${c?.label || "component"}: ${c?.value == null ? "no data" : `${c.value}${c.unit || ""}`}`,
    ];
    if (c?.target && c.target.value != null) {
      parts.push(`target ${c.target.op || ">="} ${c.target.value}`);
    }
    if (c?.score != null) parts.push(`score ${c.score}%`);
    if (Number.isFinite(c?.weight)) parts.push(`weight ${c.weight}`);
    return parts.join(", ");
  });
  if (lines.length) bits.push(`components — ${lines.join("; ")}`);
  return bits.length ? `scorecard (live) — ${bits.join("; ")}` : "";
}

/**
 * Render the evidence a user attached to checklist items as a compact
 * "label: proof" string for the grader. Empty when no item carries evidence.
 * This is what lets the grader credit "documented" criteria against real
 * proof (a note, link, or measured value) instead of a bare checkbox.
 */
function evidenceLines(items) {
  if (!Array.isArray(items)) return "";
  return items
    .filter((it) => it && typeof it.evidence === "string" && it.evidence.trim())
    .map((it) => `${it.label}: ${String(it.evidence).trim()}`)
    .slice(0, 8)
    .join("; ");
}

/**
 * Aggregate a RECURRING_MILESTONE's entries across ALL periods so the grader
 * can judge "every period" criteria + streaks — not just the latest quarter.
 *
 * Each toggle appends a `{ periodKey, items }` entry; entries are ts-ascending,
 * so the LAST entry for a given periodKey is that period's current state.
 * Returns per-period completion, count complete, the earliest incomplete
 * period, and the current streak of consecutive complete periods (newest back).
 */
function recurringMilestoneSummary(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const byPeriod = new Map();
  for (const e of list) {
    const pk = e?.value?.periodKey;
    if (!pk) continue;
    byPeriod.set(pk, e); // ts-ascending → later write wins = current state
  }
  if (byPeriod.size === 0) return null;

  const rows = [...byPeriod.keys()]
    .sort() // periodKeys (e.g. "2026-Q1" < "2026-Q2") sort chronologically
    .map((pk) => {
      const items = Array.isArray(byPeriod.get(pk)?.value?.items)
        ? byPeriod.get(pk).value.items
        : [];
      const total = items.length;
      const done = items.filter((it) => it && it.done).length;
      const open = items
        .filter((it) => it && !it.done)
        .map((it) => it.label)
        .filter(Boolean);
      return {
        pk,
        done,
        total,
        complete: total > 0 && done === total,
        open,
        evidence: evidenceLines(items),
      };
    });

  let streak = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i].complete) streak += 1;
    else break;
  }

  return {
    rows,
    total: rows.length,
    completeCount: rows.filter((r) => r.complete).length,
    firstIncomplete: rows.find((r) => !r.complete) || null,
    streak,
  };
}

/** Render the goal's context answers as "- prompt: answer" lines for the grader. */
function contextToText(spec, answers) {
  const questions = spec?.context?.questions || [];
  if (questions.length === 0 || !answers || typeof answers !== "object") {
    return "";
  }
  const lines = [];
  for (const q of questions) {
    const a = answers[q.id];
    if (a == null) continue;
    const text = Array.isArray(a)
      ? a.map((s) => String(s).trim()).filter(Boolean).join("; ")
      : String(a).trim();
    if (text) lines.push(`- ${q.prompt}: ${text}`);
  }
  return lines.join("\n");
}

export function useGoalTier(goalId, spec) {
  // Re-render when a verdict lands in the store. Captured (not discarded):
  // the grading effect below depends on it, so a verdict landing under a
  // STALE key (the in-flight call's key changed again before it resolved)
  // re-fires the effect instead of wedging in "loading" forever — the
  // in-flight guard in gradeGoalTier() had silently dropped that retry.
  const tiersTick = useSyncExternalStore(
    subscribeGoalTiers,
    getGoalTiersSnapshot,
    getGoalTiersServerSnapshot,
  );
  const { snapshots } = useSnapshots();
  const { entries } = useGoalInputs(goalId);
  // useGoalInputs subscribes to the inputs store tick, so this re-reads on
  // hydration — used below to defer grading until the live data is loaded.
  const inputsHydrated = getInputsState().fetched;
  const isScorecard = spec?.widget === SPEC_KINDS.SCORECARD;
  const tiers = spec?.tiers || null;
  // The classifier's contract is to never emit tierScale for SCORECARD (it's
  // graded qualitatively — the AI reads the composite + component readings
  // as prose). Enforced here too, defensively: liveReading.score is a "%
  // of targets attained" composite (always higher-is-better, 0-100), but
  // tierScale.direction/units describe an arbitrary metric — if a
  // misbehaving classifier response ever slipped a tierScale onto a
  // SCORECARD spec, gradeNumericTier would compare the composite against
  // the wrong-unit thresholds (or flip pass/fail under direction:"lower").
  const tierScale = isScorecard ? null : spec?.tierScale || null;

  const snapReading = useMemo(
    () => latestReadingFor(snapshots, goalId),
    [snapshots, goalId],
  );

  // Live reading published by the widget itself (SCORECARD) — fresher than
  // any snapshot, and the only view of component data the hook can't
  // recompute. Subscribing means a component change re-derives the cache
  // key below, which is what re-triggers grading.
  //
  // Gated on isScorecard: the store is never cleared when a goal is
  // reclassified to a different widget kind (nothing but a mounted
  // ScorecardWidget ever calls publishGoalLiveReading), so an unguarded
  // read would let a stale composite score hijack a differently-typed
  // widget's grading — e.g. a leftover 85% "achieving" a COUNTER goal's
  // "role model" tier against zero real entries.
  const liveTick = useSyncExternalStore(
    subscribeGoalLiveReadings,
    getGoalLiveReadingsSnapshot,
    getGoalLiveReadingsServerSnapshot,
  );
  const liveReading = useMemo(() => {
    if (!isScorecard) return null;
    const live = readGoalLiveReading(goalId);
    // Match on the widget kind too — the store is never cleared on
    // reclassification, so a goal that used to be a CI/CD or rubric widget can
    // still hold a stale foreign-kind reading (no .score) under its id. Without
    // this guard that reading would inflate hasAnyData below and make the
    // grader score emptiness instead of returning AWAITING_VERDICT (mirrors
    // Evidence's fromLiveReading, which guards on live.widget === spec.widget).
    return live?.widget === SPEC_KINDS.SCORECARD ? live : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScorecard, goalId, liveTick]);

  // W1: the single numeric reading the widget is graded on, when a numeric
  // ladder (tierScale) exists. Null for qualitative widgets / no data yet.
  // A published live score outranks the (possibly stale) snapshot reading.
  const reading = useMemo(() => {
    if (!tierScale) return null;
    if (liveReading && Number.isFinite(liveReading.score)) {
      return { value: liveReading.score, unit: "%" };
    }
    return numericReadingFor(spec, entries, snapReading);
  }, [tierScale, spec, entries, snapReading, liveReading]);
  // INCIDENT_LOG grades the CURRENT cadence period (buildCurrentData windows to
  // it), so "has data" must mean "has a current-period reading" — otherwise at a
  // period rollover, out-of-window entries keep this true and the grader scores
  // the empty window (a spurious verdict) instead of deferring, diverging from
  // Evidence which shows "no data". It shares the exact predicate the reader
  // uses, and deliberately ignores snap/live: captureGoalReadings has no
  // INCIDENT_LOG case (snapReading is never legitimately set for it) and
  // liveReading is scorecard-only, so OR-ing them could only let a stale reading
  // left by a reclassified goal inflate the gate.
  const hasAnyData =
    spec?.widget === SPEC_KINDS.INCIDENT_LOG
      ? incidentHasCurrentData(spec, entries)
      : (Array.isArray(entries) && entries.length > 0) ||
        snapReading != null ||
        liveReading != null;

  // The user's own definitions (context answers) — fed into the AI grader
  // so it judges qualitative goals against the user's truth, not a guess.
  const { answers: contextAnswers } = useGoalContext(goalId);

  // Readiness gate — a goal still in "define before tracking" (or flagged
  // untrackable / delegated) is not graded at all: the criteria may be about
  // to change (saving answers can re-scope the goal or swap the widget), and
  // any existing entries predate the user's definitions.
  const contextComplete = useIsContextComplete(spec);
  const needsSetup = specNeedsSetup(spec, contextComplete);

  // Prose summary the AI grader sees (qualitative fallback path only).
  const currentData = useMemo(() => {
    const base = buildCurrentData(spec, entries, snapReading, liveReading);
    const ctx = contextToText(spec, contextAnswers);
    return ctx
      ? `${base}\n\nUser's definitions (authoritative):\n${ctx}`
      : base;
  }, [spec, entries, snapReading, liveReading, contextAnswers]);

  // Cache key busts on a new day OR any change to what the verdict depends
  // on: tiers, live data, the numeric ladder, and the numeric value.
  const key = useMemo(() => {
    if (!tiers && !tierScale) return null;
    const basis =
      JSON.stringify(tiers) +
      "|" +
      currentData +
      "|" +
      JSON.stringify(tierScale) +
      "|" +
      (reading ? String(reading.value) : "");
    return `${todayStamp()}:${hashStr(basis)}`;
  }, [tiers, currentData, tierScale, reading]);

  useEffect(() => {
    if (!goalId || !key) return;
    if (!tiers && !tierScale) return;
    if (!inputsHydrated) return;
    if (needsSetup) return; // not ready — don't grade (and don't spend an AI call)

    // 1. Deterministic numeric grade — compare reading to thresholds, no AI.
    //    Instant, free, always consistent with the displayed number.
    if (tierScale && reading) {
      const verdict = gradeNumericTier(reading.value, tierScale);
      if (verdict) {
        setGoalTierVerdict(goalId, verdict, key);
        return;
      }
    }
    // 2. Nothing usable to grade yet → "awaiting data" (don't spend an AI
    //    call grading emptiness, which is what produced "can't rank").
    if (!hasAnyData || (tierScale && !reading && !tiers)) {
      setGoalTierVerdict(goalId, AWAITING_VERDICT, key);
      return;
    }
    // 3. Qualitative widget (or a spec without a numeric ladder) → AI grader.
    if (tiers) {
      void gradeGoalTier({
        goalId,
        goalTitle: spec?.title,
        tiers,
        currentData,
        key,
        aiProvider: getAiProvider(),
      });
    } else {
      setGoalTierVerdict(goalId, AWAITING_VERDICT, key);
    }
    // tiersTick: re-check after ANY verdict lands (including one that
    // resolved under a now-stale key) so a dropped retry isn't permanent —
    // gradeGoalTier's own freshness check makes the extra re-checks cheap
    // no-ops when the stored verdict already matches `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId, key, inputsHydrated, needsSetup, tiersTick]);

  const stored = readGoalTier(goalId);
  // A not-ready goal reports "pending setup" regardless of any cached verdict
  // (which may predate the current definitions being edited).
  const verdict = needsSetup
    ? SETUP_VERDICT
    : stored && stored.key === key
      ? stored
      : null;

  return {
    hasTiers: !!(tiers || tierScale),
    tiers,
    verdict,
    loading: !!(tiers || tierScale) && !verdict,
    regrade: () =>
      gradeGoalTier({
        goalId,
        goalTitle: spec?.title,
        tiers,
        currentData,
        key,
        aiProvider: getAiProvider(),
        force: true,
      }),
  };
}

/** The ordered tier ladder + display labels — shared with the UI (Phase 3). */
export const TIER_ORDER = [
  "not_achieved",
  "achieved",
  "over_achieved",
  "role_model",
];
export const TIER_LABELS = {
  not_achieved: "Not achieved",
  achieved: "Achieved",
  over_achieved: "Over achieved",
  role_model: "Role model",
};
/** Map a tier id → the spec.tiers field that holds its criterion. */
export const TIER_FIELD = {
  not_achieved: "notAchieved",
  achieved: "achieved",
  over_achieved: "overAchieved",
  role_model: "roleModel",
};

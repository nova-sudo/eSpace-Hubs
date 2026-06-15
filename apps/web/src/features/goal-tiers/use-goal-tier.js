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
import { useGoalInputs, getInputsState } from "@/features/goal-inputs";
import { useGoalContext } from "@/features/goal-context";
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
import { gradeNumericTier, numericReadingFor } from "./grade-numeric";

/** Shown when there's no usable reading yet — deferred, not "not achieved". */
const AWAITING_VERDICT = Object.freeze({
  tier: null,
  awaiting: true,
  reasoning: "Awaiting data — fill the check-in or connect the source.",
  confidence: "low",
});

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
function buildCurrentData(spec, entries, reading) {
  const widget = spec?.widget;
  const list = Array.isArray(entries) ? entries : [];
  const latest = list.length ? list[list.length - 1] : null;

  switch (widget) {
    case SPEC_KINDS.MILESTONE:
    case SPEC_KINDS.RECURRING_MILESTONE: {
      const items = Array.isArray(latest?.value?.items) ? latest.value.items : [];
      if (items.length === 0) return readingToText(reading);
      const done = items.filter((it) => it && it.done).length;
      const total = items.length;
      const pct = Math.round((done / total) * 100);
      const open = items
        .filter((it) => it && !it.done)
        .map((it) => it.label)
        .filter(Boolean);
      const periodNote =
        widget === SPEC_KINDS.RECURRING_MILESTONE
          ? " in the latest tracked period"
          : "";
      return [
        `${done}/${total} checklist items complete${periodNote} (${pct}%)`,
        open.length
          ? `incomplete: ${open.slice(0, 8).join("; ")}`
          : "all items complete",
      ].join("; ");
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
      const incidents = list.filter(
        (e) => e?.value && typeof e.value === "object",
      );
      const downtime = incidents.reduce(
        (s, e) => s + (Number(e.value?.downtime) || 0),
        0,
      );
      return `${incidents.length} incidents logged${downtime ? `; total downtime ${downtime} min` : ""}`;
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
  // Re-render when a verdict lands in the store.
  useSyncExternalStore(
    subscribeGoalTiers,
    getGoalTiersSnapshot,
    getGoalTiersServerSnapshot,
  );
  const { snapshots } = useSnapshots();
  const { entries } = useGoalInputs(goalId);
  // useGoalInputs subscribes to the inputs store tick, so this re-reads on
  // hydration — used below to defer grading until the live data is loaded.
  const inputsHydrated = getInputsState().fetched;
  const tiers = spec?.tiers || null;
  const tierScale = spec?.tierScale || null;

  const snapReading = useMemo(
    () => latestReadingFor(snapshots, goalId),
    [snapshots, goalId],
  );

  // W1: the single numeric reading the widget is graded on, when a numeric
  // ladder (tierScale) exists. Null for qualitative widgets / no data yet.
  const reading = useMemo(
    () => (tierScale ? numericReadingFor(spec, entries, snapReading) : null),
    [tierScale, spec, entries, snapReading],
  );
  const hasAnyData =
    (Array.isArray(entries) && entries.length > 0) || snapReading != null;

  // The user's own definitions (context answers) — fed into the AI grader
  // so it judges qualitative goals against the user's truth, not a guess.
  const { answers: contextAnswers } = useGoalContext(goalId);

  // Prose summary the AI grader sees (qualitative fallback path only).
  const currentData = useMemo(() => {
    const base = buildCurrentData(spec, entries, snapReading);
    const ctx = contextToText(spec, contextAnswers);
    return ctx
      ? `${base}\n\nUser's definitions (authoritative):\n${ctx}`
      : base;
  }, [spec, entries, snapReading, contextAnswers]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId, key, inputsHydrated]);

  const stored = readGoalTier(goalId);
  const verdict = stored && stored.key === key ? stored : null;

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

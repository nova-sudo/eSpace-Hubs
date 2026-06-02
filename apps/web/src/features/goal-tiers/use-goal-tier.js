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
import { getAiProvider } from "@/features/analyst/use-ai-provider";
import {
  gradeGoalTier,
  getGoalTiersServerSnapshot,
  getGoalTiersSnapshot,
  readGoalTier,
  subscribeGoalTiers,
} from "./goal-tier-store";

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

export function useGoalTier(goalId, spec) {
  // Re-render when a verdict lands in the store.
  useSyncExternalStore(
    subscribeGoalTiers,
    getGoalTiersSnapshot,
    getGoalTiersServerSnapshot,
  );
  const { snapshots } = useSnapshots();
  const tiers = spec?.tiers || null;

  const currentData = useMemo(
    () => readingToText(latestReadingFor(snapshots, goalId)),
    [snapshots, goalId],
  );

  // Cache key: a new day OR changed tiers/data busts it and re-grades.
  const key = useMemo(
    () =>
      tiers
        ? `${todayStamp()}:${hashStr(JSON.stringify(tiers) + "|" + currentData)}`
        : null,
    [tiers, currentData],
  );

  useEffect(() => {
    if (!goalId || !tiers || !key) return;
    void gradeGoalTier({
      goalId,
      goalTitle: spec?.title,
      tiers,
      currentData,
      key,
      aiProvider: getAiProvider(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId, key]);

  const stored = readGoalTier(goalId);
  const verdict = stored && stored.key === key ? stored : null;

  return {
    hasTiers: !!tiers,
    tiers,
    verdict,
    loading: !!tiers && !verdict,
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

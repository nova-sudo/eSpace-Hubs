"use client";

/**
 * React binding for a classification run.
 *
 * The run itself lives in classify-run-store.js (a module singleton) so it
 * survives page navigation — the classifier stream, phase, and pending-spec
 * review buffer all outlive this hook. Here we only:
 *   - flatten the caller's goal tree into the classifier's input shape,
 *   - kick the store's run,
 *   - mirror the store's live state into React via useSyncExternalStore.
 *
 * The public shape is unchanged from when the run lived here, so the analyst
 * page consumes it exactly as before.
 */

import { useCallback, useSyncExternalStore } from "react";
import { useGoals } from "@/features/goals";
import {
  CLASSIFY_PHASES,
  subscribeClassifyRun,
  getClassifyRunSnapshot,
  getClassifyRunServerSnapshot,
  getClassifyRunState,
  startClassifyRun,
  abortClassifyRun,
  resetClassifyRun,
  commitSpec,
  commitAllPending,
  discardSpec,
  discardAllPending,
  updatePendingSpec,
} from "./classify-run-store";

export { CLASSIFY_PHASES };

/**
 * Flatten the L1/L2 tree into the classifier's input shape.
 *
 * Only L2s are emitted — L1s are *titles* / category headers in the eSpace
 * performance-review model and don't get classified as individual goals with
 * widgets. The dashboard's Goal Tracking section + the evidence sheet render
 * L1s as section headers above their L2 children even when the L1 has no spec,
 * so we get the visual grouping without a spurious widget per L1.
 *
 * Each L2 carries its parent L1's title so the classifier can use that
 * hierarchical context when picking a widget. The `description` we ship is a
 * richly-structured block concatenating every piece of user context the AI
 * needs (category, priority, weightage, window, free-text context, rubric).
 */
export function flattenGoalsForClassification(tree) {
  const out = [];
  for (const l1 of tree?.l1s || []) {
    if (!l1.title?.trim()) continue;
    for (const l2 of l1.l2s || []) {
      if (!l2.id || !l2.title?.trim()) continue;
      out.push({
        id: l2.id,
        kind: "L2",
        title: l2.title.trim(),
        description: buildL2Description(l2),
        parentL1Title: l1.title.trim(),
      });
    }
  }
  return out;
}

function buildL2Description(l2) {
  const window =
    l2.startDate || l2.dueDate
      ? `${l2.startDate || "?"} → ${l2.dueDate || "?"}`
      : "";
  const meta = metaLine({
    Category: l2.category,
    Priority: l2.priority,
    Weightage: l2.weightage ? `${l2.weightage}%` : "",
    Window: window,
  });
  return joinSections([
    meta,
    sec("Context", l2.description),
    sec("Rubric", l2.rubric),
  ]);
}

function metaLine(map) {
  const entries = Object.entries(map)
    .map(([k, v]) => [k, typeof v === "string" ? v.trim() : v])
    .filter(([, v]) => v);
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}: ${v}`).join("\n");
}

function sec(header, body) {
  const v = typeof body === "string" ? body.trim() : "";
  if (!v) return "";
  return `${header}:\n${v}`;
}

function joinSections(sections) {
  return sections.filter(Boolean).join("\n\n");
}

export function useClassifyGoals() {
  const { goals } = useGoals();
  // Tick subscription — re-renders whenever the run store changes. State is
  // read imperatively (the tick is just the change signal), same pattern as
  // the other module stores.
  useSyncExternalStore(
    subscribeClassifyRun,
    getClassifyRunSnapshot,
    getClassifyRunServerSnapshot,
  );
  const s = getClassifyRunState();

  /**
   * Kick off a run. Pass `subset` to re-analyze a single goal (or a filtered
   * list) — defaults to every L2 in the tree.
   */
  const start = useCallback(
    (subset) => {
      const list =
        subset && Array.isArray(subset)
          ? subset
          : flattenGoalsForClassification(goals);
      return startClassifyRun(list);
    },
    [goals],
  );

  return {
    events: s.events,
    phase: s.phase,
    error: s.error,
    inProgress: s.phase === CLASSIFY_PHASES.RUNNING,
    start,
    abort: abortClassifyRun,
    reset: resetClassifyRun,
    // Review/edit surface — module functions, referentially stable.
    pendingSpecs: s.pendingSpecs,
    pendingCount: Object.keys(s.pendingSpecs).length,
    commitSpec,
    commitAllPending,
    discardSpec,
    discardAllPending,
    updatePendingSpec,
  };
}

"use client";

/**
 * Live widget readings for the tier grader.
 *
 * Some widgets' "current value" only exists while the widget is mounted —
 * SCORECARD aggregates SWR data sources, sub-goal inputs, and rubric
 * verdicts that useGoalTier can't recompute itself. Those widgets publish
 * their computed reading here; useGoalTier folds it into the grading
 * cache key, so a component change re-triggers the tier grade the same
 * way a manual entry does.
 *
 * localStorage-backed (like goal-tier-store) so the reading survives
 * navigation — the badge on the Intelligence page grades against the same
 * data the Goals page widget displayed, instead of flip-flopping between
 * "live" and "no data" cache keys per page.
 */

const STORAGE_KEY = "espace-devhub:goal-live-readings";
const CHANGE_EVENT = "goal-live-readings:change";

/** { [goalId]: object } — widget-shaped reading payloads */
let state = {};
let tick = 0;
let loaded = false;

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") state = parsed;
  } catch {
    /* ignore corrupt cache */
  }
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota / disabled — fine, republished on next widget mount */
  }
}

function notify() {
  tick += 1;
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}

export function subscribeGoalLiveReadings(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}
export function getGoalLiveReadingsSnapshot() {
  return tick;
}
export function getGoalLiveReadingsServerSnapshot() {
  return 0;
}

/** Last published reading for a goal, or null. */
export function readGoalLiveReading(goalId) {
  load();
  return (goalId && state[goalId]) || null;
}

/**
 * Publish a goal's live reading (or null to clear it, e.g. when the widget
 * no longer has any data). Idempotent on deep-equal payloads so widgets can
 * call it from a render effect without notify loops.
 */
export function publishGoalLiveReading(goalId, reading) {
  load();
  if (!goalId) return;
  const next = reading == null ? null : reading;
  const prev = state[goalId] ?? null;
  if (JSON.stringify(prev) === JSON.stringify(next)) return;
  if (next == null) {
    const { [goalId]: _dropped, ...rest } = state;
    state = rest;
  } else {
    state = { ...state, [goalId]: next };
  }
  persist();
  notify();
}

export function resetGoalLiveReadings() {
  state = {};
  loaded = true;
  notify();
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("auth:user-storage-cleared", resetGoalLiveReadings);
}

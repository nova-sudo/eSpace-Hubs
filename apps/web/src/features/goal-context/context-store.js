/**
 * Goal-context store — localStorage-backed per-goal answers to the
 * `spec.context.questions` the AI produces.
 *
 * Kept separate from:
 *   - `goal-specs` (AI output shape, per-goal)
 *   - `goal-inputs` (user time-series for manual widgets)
 *
 * …so each layer has exactly one concern. The spec declares WHAT the user
 * should define; this store holds those definitions; widgets consume both
 * via hooks.
 *
 * Data shape:
 *   {
 *     [goalId]: {
 *       [questionId]: string | string[] | number,
 *       __updatedAt: number
 *     }
 *   }
 */

const STORAGE_KEY = "espace-devhub:goal-context";
const CHANGE_EVENT = "goal-context:change";

export const GOAL_CONTEXT_CHANGE_EVENT = CHANGE_EVENT;

function readAll() {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function writeAll(next) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Read a single goal's answer map, or {} if nothing saved yet. */
export function readContextFor(goalId) {
  if (!goalId) return {};
  const all = readAll();
  return all[goalId] || {};
}

/**
 * Save answers for one goal. `answers` is a partial map — existing keys
 * are merged/overwritten; untouched keys are preserved. Pass `null` as a
 * value to delete a single answer.
 */
export function saveContextFor(goalId, answers) {
  if (!goalId || typeof answers !== "object" || answers === null) return;
  const all = readAll();
  const current = { ...(all[goalId] || {}) };
  for (const [k, v] of Object.entries(answers)) {
    if (v === null) delete current[k];
    else current[k] = v;
  }
  current.__updatedAt = Date.now();
  all[goalId] = current;
  writeAll(all);
}

/** Clear all context answers for one goal (leaves the spec untouched). */
export function clearContextFor(goalId) {
  if (!goalId) return;
  const all = readAll();
  if (!(goalId in all)) return;
  delete all[goalId];
  writeAll(all);
}

/**
 * Predicate — have all the required questions for this spec been answered?
 * Empty string / empty array counts as unanswered.
 */
export function isContextComplete(spec) {
  if (!spec?.context?.required) return true;
  const questions = spec.context.questions || [];
  if (questions.length === 0) return true;
  const answers = readContextFor(spec.goalId);
  return questions.every((q) => hasAnswer(answers[q.id], q.kind));
}

function hasAnswer(value, kind) {
  if (value == null) return false;
  if (kind === "list") return Array.isArray(value) && value.length > 0;
  if (kind === "number") return typeof value === "number" && !Number.isNaN(value);
  if (typeof value === "string") return value.trim().length > 0;
  return Boolean(value);
}

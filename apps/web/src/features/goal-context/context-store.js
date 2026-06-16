"use client";

/**
 * API-direct store for goal-context — per-goal answers to the
 * `spec.context.questions` the AI produces.
 *
 * History
 * ───────
 * Replaces the prior localStorage-primary + mirror store. The
 * <ContextSync /> pull-and-merge mount is gone — hydration is driven by
 * the consuming hooks (useGoalContext / useIsContextComplete) on
 * session establishment. Same API-direct pattern as goals (C1),
 * snapshots (C2), evidence (C3): module-level state, monotonic-tick
 * snapshot, idempotent fetch, optimistic writes with rollback, reset on
 * `auth:user-storage-cleared`.
 *
 * Kept separate from `goal-specs` (AI output shape) and `goal-inputs`
 * (user time-series) so each layer has exactly one concern.
 *
 * In-memory shape:
 *   { [goalId]: { answers: { [questionId]: string|string[]|number|boolean },
 *                 updatedAt: ISOString } }
 *
 * Backend: /api/v1/goal-context
 *   GET    /          → { [goalId]: { answers, updatedAt } }
 *   PUT    /:goalId    body { answers } (partial merge; null deletes a key)
 *   DELETE /:goalId
 */

import { apiDelete, apiGet, apiPut } from "@/lib/api-client";

const CHANGE_EVENT = "goal-context:change";

export const GOAL_CONTEXT_CHANGE_EVENT = CHANGE_EVENT;

/* ─────────────────────── state ─────────────────────── */

const INITIAL_STATE = Object.freeze({
  loading: false,
  fetched: false,
  error: null,
  /** { [goalId]: { answers, updatedAt } } */
  byGoal: {},
});

let state = INITIAL_STATE;
let inflightFetch = null;
let snapshotTick = 0;

function bumpSnapshot() {
  snapshotTick += 1;
}

function emit() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function setState(patch) {
  state = { ...state, ...patch };
  bumpSnapshot();
  emit();
}

export function getContextState() {
  return state;
}

export function subscribeContext(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

export function getContextSnapshot() {
  return snapshotTick;
}
export function getContextServerSnapshot() {
  return 0;
}

export function resetContext() {
  state = INITIAL_STATE;
  inflightFetch = null;
  bumpSnapshot();
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("auth:user-storage-cleared", resetContext);
}

/* ─────────────────────── reads ─────────────────────── */

/**
 * Read a single goal's answer map, or {} if nothing saved yet.
 * Includes the back-compat `__updatedAt` epoch-ms marker the old
 * localStorage store exposed.
 */
export function readContextFor(goalId) {
  if (!goalId) return {};
  const entry = state.byGoal[goalId];
  if (!entry) return {};
  const answers = entry.answers || {};
  if (entry.updatedAt) {
    const ms = Date.parse(entry.updatedAt);
    if (!Number.isNaN(ms)) return { ...answers, __updatedAt: ms };
  }
  return { ...answers };
}

/**
 * Predicate — have all the required questions for this spec been
 * answered? Empty string / empty array counts as unanswered.
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
  if (kind === "list" || kind === "resource_link")
    return Array.isArray(value) && value.length > 0;
  if (kind === "number")
    return typeof value === "number" && !Number.isNaN(value);
  if (typeof value === "string") return value.trim().length > 0;
  return Boolean(value);
}

/* ─────────────────────── hydration ─────────────────────── */

export async function fetchContext() {
  if (inflightFetch) return inflightFetch;
  setState({ loading: true, error: null });
  inflightFetch = (async () => {
    const r = await apiGet("/goal-context");
    inflightFetch = null;
    if (!r.ok) {
      const isAuth =
        r.error?.code === "unauthenticated" ||
        r.error?.code === "totp_required";
      setState({ loading: false, error: isAuth ? null : r.error });
      return state.byGoal;
    }
    const map = r.data && typeof r.data === "object" ? r.data : {};
    const byGoal = {};
    for (const [goalId, doc] of Object.entries(map)) {
      if (doc && typeof doc === "object" && doc.answers) {
        byGoal[goalId] = {
          answers: doc.answers,
          updatedAt:
            typeof doc.updatedAt === "string" ? doc.updatedAt : null,
        };
      }
    }
    setState({ loading: false, fetched: true, error: null, byGoal });
    return byGoal;
  })();
  return inflightFetch;
}

/* ─────────────────────── writes ─────────────────────── */

/**
 * Save answers for one goal. `answers` is a PARTIAL map — existing keys
 * are merged/overwritten; untouched keys are preserved. Pass `null` as a
 * value to delete a single answer (server applies the same rule).
 *
 * Optimistic: the merged answers appear locally immediately; the PUT
 * sends the partial (server owns the merge). Rollback on failure.
 */
export function saveContextFor(goalId, answers) {
  if (!goalId || typeof answers !== "object" || answers === null) return;
  const prevEntry = state.byGoal[goalId];

  // Optimistic local merge (mirrors the server's partial semantics).
  const current = { ...(prevEntry?.answers || {}) };
  for (const [k, v] of Object.entries(answers)) {
    if (k === "__updatedAt") continue;
    if (v === null) delete current[k];
    else current[k] = v;
  }
  setState({
    byGoal: {
      ...state.byGoal,
      [goalId]: { answers: current, updatedAt: new Date().toISOString() },
    },
    error: null,
  });

  void putContextRemote(goalId, answers, prevEntry);
}

async function putContextRemote(goalId, answers, prevEntry) {
  // Strip the local __updatedAt marker — the server rejects extra props.
  const { __updatedAt: _ignored, ...payload } = answers;
  const r = await apiPut(`/goal-context/${encodeURIComponent(goalId)}`, {
    answers: payload,
  });
  if (r.ok) {
    // Reconcile the server's canonical answers + updatedAt.
    if (r.data?.answers && typeof r.data.answers === "object") {
      setState({
        byGoal: {
          ...state.byGoal,
          [goalId]: {
            answers: r.data.answers,
            updatedAt:
              typeof r.data.updatedAt === "string" ? r.data.updatedAt : null,
          },
        },
      });
    }
    return;
  }
  if (
    r.error?.code === "unauthenticated" ||
    r.error?.code === "totp_required"
  ) {
    return;
  }
  // Rollback to the previous per-goal entry.
  const next = { ...state.byGoal };
  if (prevEntry) next[goalId] = prevEntry;
  else delete next[goalId];
  setState({ byGoal: next, error: r.error });
  // eslint-disable-next-line no-console
  console.warn(
    "[goal-context] save failed:",
    r.error?.code,
    r.error?.message,
  );
}

/** Clear all context answers for one goal (leaves the spec untouched). */
export function clearContextFor(goalId) {
  if (!goalId || !(goalId in state.byGoal)) return;
  const prevEntry = state.byGoal[goalId];
  const next = { ...state.byGoal };
  delete next[goalId];
  setState({ byGoal: next, error: null });
  void clearContextRemote(goalId, prevEntry);
}

async function clearContextRemote(goalId, prevEntry) {
  const r = await apiDelete(`/goal-context/${encodeURIComponent(goalId)}`);
  if (r.ok) return;
  if (r.error?.code === "not_found" || r.status === 404) return;
  if (
    r.error?.code === "unauthenticated" ||
    r.error?.code === "totp_required"
  ) {
    return;
  }
  if (!(goalId in state.byGoal) && prevEntry) {
    setState({
      byGoal: { ...state.byGoal, [goalId]: prevEntry },
      error: r.error,
    });
  } else {
    setState({ error: r.error });
  }
  // eslint-disable-next-line no-console
  console.warn(
    "[goal-context] clear failed:",
    r.error?.code,
    r.error?.message,
  );
}

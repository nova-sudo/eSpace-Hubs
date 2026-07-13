"use client";

/**
 * Module-level runner for a goal-classification ("analysis") pass.
 *
 * The run used to live entirely inside the useClassifyGoals hook, so navigating
 * away from the analyst overlay unmounted it and aborted the in-flight stream —
 * the classification the user kicked off was silently canceled and the
 * reviewed-but-uncommitted specs were lost. Hoisting the whole run + its
 * pending-spec buffer into this singleton (mirroring goal-tier-store /
 * specs-store) makes an analysis pass survive page navigation: only an explicit
 * abort() stops it, and the review buffer is still there when the user returns.
 *
 * Registers itself with the shared jobs store while running so the shell toast
 * shows "Analyzing your goals" on any page.
 */

import { getAiProvider } from "./use-ai-provider";
import { markAnalyzedAt, saveSpec, readValidSpecs } from "@/features/goal-specs";
import { readContextFor } from "@/features/goal-context";
import { clearGoalEntries } from "@/features/goal-inputs";
import { clearGoalLocks } from "@/features/goal-locks";
import { ANALYSIS } from "./ai/analysis-events";
import { startJob, endJob } from "@/lib/jobs-store";

/**
 * Re-analysis replaces the widget, so the goal's logged entries + settle-locks
 * belong to a (possibly) different widget shape and would corrupt the new
 * widget's reading. Wipe them on commit so the re-analyzed widget starts clean.
 * No-op when there's no history (a first-ever classification), so it's safe to
 * call on every committed spec.
 */
function wipeGoalHistory(goalId) {
  if (!goalId) return;
  clearGoalEntries(goalId);
  clearGoalLocks(goalId);
}

const CHANGE_EVENT = "classify-run:change";
const JOB_ID = "analysis";

export const CLASSIFY_PHASES = Object.freeze({
  IDLE: "idle",
  RUNNING: "running",
  COMPLETE: "complete",
  ERROR: "error",
});
const PHASES = CLASSIFY_PHASES;

/**
 * Live run state — read via useSyncExternalStore in the hook.
 *
 * `pendingSpecs` is a plain object keyed by goalId (not a Map) so every mutation
 * creates a new reference for React's Object.is snapshot check. It buffers
 * classified specs before the Review pane commits them — see the analyst page.
 */
let state = { phase: PHASES.IDLE, events: [], error: null, pendingSpecs: {} };
let tick = 0;
let ctrl = null; // AbortController for the active run; only abort() touches it.

function emit() {
  tick += 1;
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}
function setState(patch) {
  state = { ...state, ...patch };
  emit();
}

export function subscribeClassifyRun(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}
export function getClassifyRunSnapshot() {
  return tick;
}
export function getClassifyRunServerSnapshot() {
  return 0;
}
export function getClassifyRunState() {
  return state;
}

/**
 * Attach each goal's SAVED context answers (Q→A pairs) to the classify payload.
 * Without this, re-analyzing (Re-analyze all / Analyze remaining / per-goal
 * retry) drops the user's definitions, regressing a context-fitted widget back
 * to a generic one. Goals with no spec or no saved answers are sent unchanged.
 */
function withContextAnswers(list) {
  let specs;
  try {
    specs = readValidSpecs();
  } catch {
    return list; // store not hydrated yet — send goals as-is
  }
  return list.map((g) => {
    const spec = specs[g.id];
    const questions = spec?.context?.questions || [];
    if (!questions.length) return g;
    const answers = readContextFor(g.id) || {};
    const pairs = [];
    for (const q of questions) {
      const raw = answers[q.id];
      let answer = "";
      if (q.kind === "list" || q.kind === "resource_link") {
        answer = Array.isArray(raw)
          ? raw.map((s) => String(s).trim()).filter(Boolean).join("\n")
          : "";
      } else if (q.kind === "number") {
        answer = typeof raw === "number" && !Number.isNaN(raw) ? String(raw) : "";
      } else {
        answer = typeof raw === "string" ? raw.trim() : "";
      }
      if (answer) pairs.push({ prompt: q.prompt, answer });
    }
    return pairs.length ? { ...g, contextAnswers: pairs } : g;
  });
}

/** Read a ReadableStream of NDJSON into an async iterator of parsed events. */
async function* readNdjson(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          yield JSON.parse(line);
        } catch {
          /* skip bad line */
        }
      }
    }
    const tail = buffer.trim();
    if (tail) {
      try {
        yield JSON.parse(tail);
      } catch {
        /* ignore */
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Kick off a classification run over `list` (already-flattened goals). Guards
 * against a concurrent run. Streams the NDJSON classifier response into module
 * state; each GOAL_CLASSIFIED is buffered into pendingSpecs for the Review pane.
 * Survives navigation — nothing here is tied to a component's lifecycle.
 */
export async function startClassifyRun(list) {
  if (state.phase === PHASES.RUNNING) return;
  if (!Array.isArray(list) || list.length === 0) {
    setState({
      error: "No goals to classify. Add goals in Settings first.",
      phase: PHASES.ERROR,
    });
    return;
  }
  // Optimistic kick-off: seed a synthetic START so the summary strip shows
  // "0 / N · analyzing · 0s" immediately, before the network call returns.
  setState({
    events: [
      { type: ANALYSIS.START, payload: { totalGoals: list.length, startedAt: Date.now() } },
    ],
    error: null,
    phase: PHASES.RUNNING,
  });
  ctrl = new AbortController();
  startJob(JOB_ID, { kind: "analysis", label: "Analyzing your goals" });
  try {
    const provider = getAiProvider();
    const res = await fetch("/api/v1/ai/classify-goals", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "x-ai-provider": provider },
      body: JSON.stringify({ goals: withContextAnswers(list), provider }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(
        errBody?.error?.message ||
          errBody?.error ||
          `Classifier responded ${res.status}`,
      );
    }
    if (!res.body) throw new Error("Classifier returned an empty stream.");
    for await (const evt of readNdjson(res.body)) {
      // BUFFER, don't save — the Review pane lets the user accept / edit /
      // discard each classification before it lands in the goal-specs store.
      if (evt.type === ANALYSIS.GOAL_CLASSIFIED && evt.payload?.spec) {
        const spec = evt.payload.spec;
        setState({ pendingSpecs: { ...state.pendingSpecs, [spec.goalId]: spec } });
      }
      setState({ events: [...state.events, evt] });
      if (evt.type === ANALYSIS.COMPLETE) markAnalyzedAt(Date.now());
    }
    setState({ phase: PHASES.COMPLETE });
  } catch (err) {
    if (err?.name === "AbortError") {
      setState({ phase: PHASES.IDLE });
      return;
    }
    setState({ error: err?.message || String(err), phase: PHASES.ERROR });
  } finally {
    ctrl = null;
    endJob(JOB_ID);
  }
}

/** User-initiated bail-out of an in-flight run. */
export function abortClassifyRun() {
  if (ctrl) ctrl.abort();
}

/** Clear the run to IDLE (events, error, and pending buffer all reset). */
export function resetClassifyRun() {
  setState({ phase: PHASES.IDLE, events: [], error: null, pendingSpecs: {} });
}

/**
 * Commit a single pending spec to the goal-specs store + drop it from the
 * buffer. Returns the saveSpec result so callers can surface validation errors.
 */
export function commitSpec(goalId) {
  const spec = state.pendingSpecs[goalId];
  if (!spec) return { ok: false, errors: ["spec not in pending buffer"] };
  const result = saveSpec(spec);
  if (result.ok) {
    wipeGoalHistory(goalId);
    const next = { ...state.pendingSpecs };
    delete next[goalId];
    setState({ pendingSpecs: next });
  }
  return result;
}

/** Commit every pending spec at once → { saved, failed } (failed stay buffered). */
export function commitAllPending() {
  const ids = Object.keys(state.pendingSpecs);
  let saved = 0;
  const failed = [];
  for (const id of ids) {
    const result = saveSpec(state.pendingSpecs[id]);
    if (result.ok) {
      saved += 1;
      wipeGoalHistory(id);
    } else failed.push({ goalId: id, errors: result.errors });
  }
  const stillFailed = new Set(failed.map((f) => f.goalId));
  const next = {};
  for (const id of Object.keys(state.pendingSpecs)) {
    if (stillFailed.has(id)) next[id] = state.pendingSpecs[id];
  }
  setState({ pendingSpecs: next });
  return { saved, failed };
}

/**
 * Stage a single freshly-classified spec into the Review buffer WITHOUT
 * running a full classification pass. Used by the per-widget "re-analyze"
 * flow: the caller runs `reclassifyOneGoal`, then stages the result here
 * and opens the analyst overlay in Review mode so the user can adjust
 * targets / weights / scope before it replaces the committed spec.
 *
 * Appends a synthetic GOAL_STARTED event so the Review card shows the
 * title + parent breadcrumb (its meta comes from that event). Leaves the
 * run phase untouched — an idle store still renders the buffer fine, and
 * a bulk run in flight just gains one more card. Commit goes through the
 * normal `commitSpec` (saveSpec + history wipe), matching re-analyze.
 */
export function stageSpecForReview(spec, meta = {}) {
  if (!spec?.goalId) return;
  const goalId = spec.goalId;
  const started = {
    type: ANALYSIS.GOAL_STARTED,
    payload: {
      goalId,
      title: meta.title || spec.title || "(untitled)",
      parentL1: meta.parentL1 || null,
    },
  };
  setState({
    events: [...state.events, started],
    pendingSpecs: { ...state.pendingSpecs, [goalId]: spec },
  });
}

/** Discard a single pending spec without saving. */
export function discardSpec(goalId) {
  if (!state.pendingSpecs[goalId]) return;
  const next = { ...state.pendingSpecs };
  delete next[goalId];
  setState({ pendingSpecs: next });
}

/** Discard every pending spec. */
export function discardAllPending() {
  setState({ pendingSpecs: {} });
}

/** Shallow-merge a patch into a pending spec (Review pane inline edits). */
export function updatePendingSpec(goalId, patch) {
  if (!state.pendingSpecs[goalId]) return;
  setState({
    pendingSpecs: {
      ...state.pendingSpecs,
      [goalId]: { ...state.pendingSpecs[goalId], ...patch },
    },
  });
}

/** Full reset on auth transition — a new user starts with a clean run. */
function resetClassifyRunStore() {
  ctrl = null;
  state = { phase: PHASES.IDLE, events: [], error: null, pendingSpecs: {} };
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("auth:user-storage-cleared", resetClassifyRunStore);
}

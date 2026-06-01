"use client";

/**
 * Client-side orchestrator for a classification run.
 *
 * Responsibilities:
 *   - POST the current goal tree to /api/v1/ai/classify-goals
 *   - Parse the NDJSON stream line-by-line
 *   - Push each event into local React state (so the analyst page can
 *     render a live process log)
 *   - Persist each GOAL_CLASSIFIED into the specs-store so the dashboard
 *     section and the widget grid update in real time
 *   - Expose `abort()` so the user can bail out of a long run
 *
 * Deliberately does NOT own the goal tree — callers pass the goals in
 * when they call `start(goals)`. That keeps the hook reusable for partial
 * re-analysis (one goal, one L1, whatever).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getAiProvider } from "./use-ai-provider";
import { useGoals } from "@/features/goals";
import { markAnalyzedAt, saveSpec } from "@/features/goal-specs";
import { ANALYSIS } from "./ai/analysis-events";

/**
 * Pending-spec buffer.
 *
 * Before the review/edit UI shipped, GOAL_CLASSIFIED events were saved
 * immediately via saveSpec(), so a single bad classification went
 * straight to the user's dashboard. Now we buffer them in
 * `pendingSpecs` and surface a Review view that lets the user inspect,
 * edit, or discard each spec before committing.
 *
 * `pendingSpecs` is a plain object keyed by goalId rather than a Map so
 * React's value-equality re-render check works on Object.is(prev,next)
 * — every mutation goes through `{ ...prev, [id]: next }` and creates a
 * new reference. (Using a Map would require manually creating a fresh
 * Map each update too, so the object form is slightly less ceremony.)
 */

/**
 * Flatten the L1/L2 tree into the classifier's input shape.
 *
 * Only L2s are emitted — L1s are *titles* / category headers in the
 * eSpace performance-review model and don't get classified as
 * individual goals with widgets. The dashboard's Goal Tracking
 * section + the evidence sheet both already render L1s as section
 * headers above their L2 children even when the L1 has no spec, so
 * we get the visual grouping without a spurious widget per L1.
 *
 * Each L2 carries its parent L1's title so the classifier can use
 * that hierarchical context when picking a widget.
 *
 * The `description` field we ship is a RICHLY-STRUCTURED block that
 * concatenates every piece of user-supplied context the AI needs to make
 * a good widget decision. Format (markdown-ish, stable sections):
 *
 *   Category: delivery
 *   Priority: high
 *   Weightage: 20%
 *   Window: 2026-01-01 → 2026-06-30
 *
 *   Context:
 *   <the user's free-text `description` field>
 *
 *   Rubric:
 *   <Not achieved / Achieved / Over / Role model criteria>
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

function buildL1Description(l1) {
  const meta = metaLine({
    Category: l1.category,
    Weightage: l1.weightage ? `${l1.weightage}%` : "",
  });
  const childTitles = (l1.l2s || [])
    .map((l) => l?.title?.trim())
    .filter(Boolean);
  return joinSections([
    meta,
    sec("Context", l1.description),
    sec("Rubric", l1.rubric),
    childTitles.length > 0
      ? sec("Mapped L2 sub-goals", childTitles.map((t) => `· ${t}`).join("\n"))
      : "",
  ]);
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

const PHASES = Object.freeze({
  IDLE: "idle",
  RUNNING: "running",
  COMPLETE: "complete",
  ERROR: "error",
});

export const CLASSIFY_PHASES = PHASES;

/**
 * Read a ReadableStream of NDJSON into an async iterator of parsed events.
 * Kept local to the hook — classifier-index.js is server-only because it
 * holds an env var.
 */
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

export function useClassifyGoals() {
  const { goals } = useGoals();
  const [events, setEvents] = useState([]);
  const [phase, setPhase] = useState(PHASES.IDLE);
  const [error, setError] = useState(null);
  // Buffer for classified specs that haven't been committed yet. See
  // the module-level comment for the rationale.
  const [pendingSpecs, setPendingSpecs] = useState(/** @type {Record<string, object>} */ ({}));
  const abortRef = useRef(null);
  const mountedRef = useRef(true);

  // CRITICAL: set mountedRef.current = true at the START of the effect,
  // not just via useRef(true) at hook init. React 19 StrictMode in dev
  // runs the cleanup once before the real mount to verify cleanup
  // correctness. With a cleanup-only effect like this one, the sequence is:
  //
  //   1. useRef(true) → mountedRef.current = true
  //   2. Effect mounts (no setup body, just returns cleanup)
  //   3. StrictMode invokes cleanup → mountedRef.current = false
  //   4. Effect re-runs (still no setup body to restore current)
  //   5. mountedRef.current stays FALSE for the rest of the component's life
  //
  // Result: every for-await loop in start() bails out at event #1 because
  // mountedRef.current reads false. The analyst UI shows
  // "0/N · analyzing · …s · Warming up" indefinitely while the server
  // stream completes fully but is ignored client-side.
  //
  // Setting current = true at the top of the effect makes step 4 restore
  // it correctly, and the cleanup at real unmount still flips it to false.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const reset = useCallback(() => {
    setEvents([]);
    setPhase(PHASES.IDLE);
    setError(null);
    setPendingSpecs({});
  }, []);

  /**
   * Commit a single pending spec to the goal-specs store + remove it
   * from the pending buffer. Returns the validateSpec result so callers
   * can surface validation errors inline.
   */
  const commitSpec = useCallback((goalId) => {
    const spec = pendingSpecs[goalId];
    if (!spec) return { ok: false, errors: ["spec not in pending buffer"] };
    const result = saveSpec(spec);
    if (result.ok) {
      setPendingSpecs((prev) => {
        const next = { ...prev };
        delete next[goalId];
        return next;
      });
    }
    return result;
  }, [pendingSpecs]);

  /**
   * Commit every pending spec at once. Returns { saved, failed } so the
   * UI can show how many landed vs. were rejected by the validator.
   */
  const commitAllPending = useCallback(() => {
    const ids = Object.keys(pendingSpecs);
    let saved = 0;
    const failed = [];
    for (const id of ids) {
      const result = saveSpec(pendingSpecs[id]);
      if (result.ok) saved += 1;
      else failed.push({ goalId: id, errors: result.errors });
    }
    setPendingSpecs((prev) => {
      const next = { ...prev };
      const stillFailed = new Set(failed.map((f) => f.goalId));
      for (const id of Object.keys(next)) {
        if (!stillFailed.has(id)) delete next[id];
      }
      return next;
    });
    return { saved, failed };
  }, [pendingSpecs]);

  /** Discard a single pending spec without saving. */
  const discardSpec = useCallback((goalId) => {
    setPendingSpecs((prev) => {
      const next = { ...prev };
      delete next[goalId];
      return next;
    });
  }, []);

  /** Discard every pending spec. */
  const discardAllPending = useCallback(() => {
    setPendingSpecs({});
  }, []);

  /**
   * Apply a partial update to a pending spec (shallow merge at the top
   * level). Used by the review UI's inline edit dropdowns — e.g. when
   * switching widget kind we patch `{ widget: "SCALE", kind: "manual" }`
   * and the rest of the spec stays put.
   */
  const updatePendingSpec = useCallback((goalId, patch) => {
    setPendingSpecs((prev) => {
      if (!prev[goalId]) return prev;
      return { ...prev, [goalId]: { ...prev[goalId], ...patch } };
    });
  }, []);

  const abort = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
  }, []);

  /**
   * Kick off a classification run. Pass `subset` to re-analyze a single
   * goal (or a filtered list) — defaults to every L1 + every L2.
   */
  const start = useCallback(
    async (subset) => {
      if (phase === PHASES.RUNNING) return;
      const list = subset && Array.isArray(subset)
        ? subset
        : flattenGoalsForClassification(goals);
      if (list.length === 0) {
        setError("No goals to classify. Add goals in Settings first.");
        setPhase(PHASES.ERROR);
        return;
      }
      // Optimistic kick-off: seed `events` with a synthetic START
      // BEFORE the network call goes out. This gives the summary
      // strip its `totalGoals` / `startedAt` so the user immediately
      // sees "0 / 12 · analyzing · 0s" instead of empty placeholder.
      //
      // We DO NOT also seed synthetic GOAL_STARTED-per-goal events:
      // the fold replaces a block on every GOAL_STARTED it sees,
      // which means a synthetic-then-server pair can race the
      // intervening REASONING/CLASSIFIED events in subtle ways
      // (observed: blocks freezing on "reading" after the server's
      // real GOAL_STARTED lands). Letting the server's GOAL_STARTED
      // be the SOLE source of block creation removes that whole
      // class of bug. Blocks appear as the server queue picks goals
      // up (concurrency=3), each transitioning reading → reasoning
      // → classified in real time.
      setEvents([
        {
          type: ANALYSIS.START,
          payload: { totalGoals: list.length, startedAt: Date.now() },
        },
      ]);
      setError(null);
      setPhase(PHASES.RUNNING);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const provider = getAiProvider();
        const res = await fetch("/api/v1/ai/classify-goals", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-ai-provider": provider,
          },
          body: JSON.stringify({ goals: list, provider }),
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
        if (!res.body) {
          throw new Error("Classifier returned an empty stream.");
        }
        for await (const evt of readNdjson(res.body)) {
          if (!mountedRef.current) break;
          // BUFFER, don't save. The Review pane lets the user accept /
          // edit / discard each classification before it lands in the
          // goal-specs store. `markAnalyzedAt` still fires on COMPLETE
          // so the header's "last run" timestamp updates as soon as the
          // run finishes (not when the user finally commits).
          if (evt.type === ANALYSIS.GOAL_CLASSIFIED && evt.payload?.spec) {
            const spec = evt.payload.spec;
            setPendingSpecs((prev) => ({ ...prev, [spec.goalId]: spec }));
          }
          setEvents((prev) => [...prev, evt]);
          if (evt.type === ANALYSIS.COMPLETE) {
            markAnalyzedAt(Date.now());
          }
        }
        if (mountedRef.current) setPhase(PHASES.COMPLETE);
      } catch (err) {
        if (err?.name === "AbortError") {
          if (mountedRef.current) setPhase(PHASES.IDLE);
          return;
        }
        if (mountedRef.current) {
          setError(err?.message || String(err));
          setPhase(PHASES.ERROR);
        }
      } finally {
        abortRef.current = null;
      }
    },
    [goals, phase],
  );

  return {
    events,
    phase,
    error,
    inProgress: phase === PHASES.RUNNING,
    start,
    abort,
    reset,
    // Review/edit surface
    pendingSpecs,
    pendingCount: Object.keys(pendingSpecs).length,
    commitSpec,
    commitAllPending,
    discardSpec,
    discardAllPending,
    updatePendingSpec,
  };
}

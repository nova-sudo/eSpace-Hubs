"use client";

/**
 * One-shot single-goal re-classification.
 *
 * The full `useClassifyGoals` hook owns a live events log + a
 * pendingSpecs buffer because the analyst page needs to render a
 * process-reveal stream and a Review pane. The dashboard's
 * ContextCollector doesn't need any of that — it just wants to send
 * one goal + its saved context answers to the classifier, wait, and
 * get a single spec back.
 *
 * This helper opens the same NDJSON endpoint, parses until it sees the
 * GOAL_CLASSIFIED event for the goalId it submitted, and resolves
 * with that spec. GOAL_FAILED rejects. COMPLETE without seeing either
 * also rejects.
 *
 * Why not reuse the hook? Because the hook's state machine is tied to
 * the analyst page's modes (RUNNING → COMPLETE → REVIEW), and pulling
 * it into a dashboard tile would either:
 *   (a) hijack the analyst's events log while the user is on the
 *       dashboard, or
 *   (b) duplicate every piece of state across two parallel hook copies.
 *
 * Keeping this as a thin Promise-returning function means the tile can
 * `setBusy(true)` → await → `saveSpec(newSpec)` with no entanglement.
 */

import { ANALYSIS } from "./ai/analysis-events";

/**
 * Read a ReadableStream of NDJSON line-by-line. Identical to the
 * reader inside `use-classify-goals.js` — duplicated here on purpose
 * so this helper can be imported by code paths that don't pull in
 * the full hook (avoids a circular-dep concern when the helper later
 * gets used from goal-widgets, which is upstream of analyst features
 * in our dependency graph).
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

/**
 * Re-classify a single goal with optional user-supplied context.
 *
 * @param {object} args
 * @param {object} args.goal — shape matches the classifier's input
 *   schema: { id, title, description?, parentL1Title?, kind }.
 * @param {Array<{prompt:string, answer:string}>} [args.contextAnswers] —
 *   Q→A pairs resolved from the user's goal-context store. Empty pairs
 *   are dropped on the server but skipping the array entirely is fine.
 * @param {AbortSignal} [args.signal] — caller-owned abort signal.
 *
 * @returns {Promise<object>} the validated spec for `goal.id`. Throws
 *   on network failure, classifier failure, or if the stream ends
 *   without producing a spec for this goal.
 */
export async function reclassifyOneGoal({ goal, contextAnswers, signal }) {
  if (!goal?.id) {
    throw new Error("reclassifyOneGoal: goal.id is required");
  }
  const provider =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("espace-devhub:ai-provider") || "mistral"
      : "mistral";

  // Build the request body. The API trims + filters empty Q/A pairs
  // server-side so we don't repeat that here; we just pass through.
  const body = {
    goals: [
      {
        id: goal.id,
        title: goal.title,
        ...(goal.description ? { description: goal.description } : {}),
        ...(goal.parentL1Title ? { parentL1Title: goal.parentL1Title } : {}),
        kind: goal.kind || "L2",
        ...(Array.isArray(contextAnswers) && contextAnswers.length > 0
          ? { contextAnswers }
          : {}),
      },
    ],
    provider,
  };

  const res = await fetch("/api/v1/ai/classify-goals", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "x-ai-provider": provider,
    },
    body: JSON.stringify(body),
    signal,
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

  // Walk the stream until we see GOAL_CLASSIFIED (success) or
  // GOAL_FAILED (failure) for this goal. We also surface a generic
  // failure if the stream COMPLETEs without either — should never
  // happen, but the analyst page handles the same case so we mirror
  // it here.
  for await (const evt of readNdjson(res.body)) {
    if (
      evt.type === ANALYSIS.GOAL_CLASSIFIED &&
      evt.payload?.spec?.goalId === goal.id
    ) {
      return evt.payload.spec;
    }
    if (
      evt.type === ANALYSIS.GOAL_FAILED &&
      evt.payload?.goalId === goal.id
    ) {
      throw new Error(
        evt.payload?.error || "Classifier failed to produce a spec.",
      );
    }
  }
  throw new Error("Classifier finished without producing a spec.");
}

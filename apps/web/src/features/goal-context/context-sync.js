"use client";

/**
 * Mirror-mode sync for goal-context (per-goal answer maps).
 *
 * Same shape as grading-sync / snapshots-sync — fire-and-forget
 * mirror writes from inside the sync save paths, plus an on-mount
 * pull that merges the API into localStorage.
 *
 * One nuance: saveContextFor is PARTIAL (passing answers={team: null}
 * deletes the `team` key, doesn't replace the whole map). The
 * mirror's PUT /goal-context/:goalId also uses partial-merge
 * semantics — same null-deletes-a-key rule on both sides. We forward
 * the partial directly; no shape transformation.
 *
 * Server-side validation: each value must be string|number|boolean|
 * string[]|null. The local store accepts anything object-y; the
 * mirror request will 400 if a widget writes something more exotic.
 * That's a "fix the widget" outcome and we want it loud, not silent —
 * console.warn carries it.
 */

import { apiDelete, apiGet, apiPut } from "@/lib/api-client";

const FAIL_LOG_PREFIX = "[goal-context-sync]";

export async function mirrorSaveContext(goalId, answers) {
  if (!goalId || !answers || typeof answers !== "object") return;
  // Strip the local __updatedAt marker before sending — the server's
  // validator rejects extra properties on /goal-context.
  const { __updatedAt: _ignored, ...payload } = answers;
  const r = await apiPut(`/goal-context/${encodeURIComponent(goalId)}`, {
    answers: payload,
  });
  if (r.ok) return;
  if (r.error?.code === "unauthenticated" || r.error?.code === "totp_required") return;
  // eslint-disable-next-line no-console
  console.warn(
    `${FAIL_LOG_PREFIX} save failed:`,
    r.error?.code,
    r.error?.message,
  );
}

export async function mirrorClearContext(goalId) {
  if (!goalId) return;
  const r = await apiDelete(`/goal-context/${encodeURIComponent(goalId)}`);
  if (r.ok) return;
  if (r.error?.code === "unauthenticated" || r.error?.code === "totp_required") return;
  // eslint-disable-next-line no-console
  console.warn(
    `${FAIL_LOG_PREFIX} clear failed:`,
    r.error?.code,
    r.error?.message,
  );
}

/**
 * Pull /goal-context and merge into localStorage. The API returns
 *   {[goalId]: {answers, updatedAt}}
 * — we call saveLocal(goalId, answers) for each, which the store
 * merges with its partial-update semantics (existing local-only keys
 * are preserved, API keys overwrite or add).
 */
export async function pullContextFromApi(saveLocal) {
  if (typeof saveLocal !== "function") return 0;
  const r = await apiGet("/goal-context");
  if (!r.ok) {
    if (r.error?.code === "unauthenticated" || r.error?.code === "totp_required") {
      return 0;
    }
    // eslint-disable-next-line no-console
    console.warn(
      `${FAIL_LOG_PREFIX} pull failed:`,
      r.error?.code,
      r.error?.message,
    );
    return 0;
  }
  const map = r.data && typeof r.data === "object" ? r.data : {};
  let merged = 0;
  for (const [goalId, doc] of Object.entries(map)) {
    if (doc && typeof doc === "object" && doc.answers) {
      saveLocal(goalId, doc.answers);
      merged += 1;
    }
  }
  return merged;
}

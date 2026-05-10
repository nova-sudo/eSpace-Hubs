"use client";

/**
 * Mirror-mode sync for goal-specs (per-goal classifier output).
 *
 * Wire shape note: the server's PUT /goal-specs/:goalId runs the
 * incoming body through the same validateSpec the classifier uses
 * (apps/api/src/modules/ai/classifier/spec-validator.ts). The local
 * store already validates with the same algorithm before persist —
 * a spec the local accepts WILL pass server validation. The "id
 * must match URL" rule on the server is satisfied because we pass
 * spec.goalId in the URL.
 *
 * clearSpecs is a special case — it wipes the entire local store.
 * Mirroring as a single DELETE doesn't exist server-side (no
 * /goal-specs without a :goalId); we'd have to list+delete-each.
 * Skipped for now — clear is a rare admin/re-analyze action.
 */

import { apiDelete, apiGet, apiPut } from "@/lib/api-client";

const FAIL_LOG_PREFIX = "[goal-specs-sync]";

function isAuthError(err) {
  return err?.code === "unauthenticated" || err?.code === "totp_required";
}

export async function mirrorSaveSpec(spec) {
  if (!spec || !spec.goalId) return;
  const r = await apiPut(
    `/goal-specs/${encodeURIComponent(spec.goalId)}`,
    spec,
  );
  if (r.ok) return;
  if (isAuthError(r.error)) return;
  // eslint-disable-next-line no-console
  console.warn(
    `${FAIL_LOG_PREFIX} save failed:`,
    r.error?.code,
    r.error?.message,
  );
}

export async function mirrorRemoveSpec(goalId) {
  if (!goalId) return;
  const r = await apiDelete(`/goal-specs/${encodeURIComponent(goalId)}`);
  if (r.ok) return;
  if (isAuthError(r.error)) return;
  // eslint-disable-next-line no-console
  console.warn(
    `${FAIL_LOG_PREFIX} remove failed:`,
    r.error?.code,
    r.error?.message,
  );
}

/**
 * Pull /goal-specs → {specs: {[goalId]: spec}, lastAnalyzedAt}.
 * For each spec call saveLocal (which re-validates and merges into
 * localStorage). The lastAnalyzedAt timestamp gets piped through
 * setLastAnalyzedAt to keep the local marker in sync.
 */
export async function pullSpecsFromApi(saveLocal, setLastAnalyzedAt) {
  if (typeof saveLocal !== "function") return 0;
  const r = await apiGet("/goal-specs");
  if (!r.ok) {
    if (isAuthError(r.error)) return 0;
    // eslint-disable-next-line no-console
    console.warn(
      `${FAIL_LOG_PREFIX} pull failed:`,
      r.error?.code,
      r.error?.message,
    );
    return 0;
  }
  const specs =
    r.data?.specs && typeof r.data.specs === "object" ? r.data.specs : {};
  let merged = 0;
  for (const [goalId, spec] of Object.entries(specs)) {
    // Caller's saveLocal runs the local validateSpec — invalid shapes
    // get skipped silently. We don't count them.
    const res = saveLocal({ ...spec, goalId });
    if (res?.ok) merged += 1;
  }
  if (
    typeof setLastAnalyzedAt === "function" &&
    typeof r.data?.lastAnalyzedAt === "number"
  ) {
    setLastAnalyzedAt(r.data.lastAnalyzedAt);
  }
  return merged;
}

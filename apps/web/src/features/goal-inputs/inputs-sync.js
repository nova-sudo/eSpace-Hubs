"use client";

/**
 * Mirror-mode sync for goal-inputs (per-goal append-only time series).
 *
 * Same fire-and-forget pattern as the other stores, plus one quirk:
 * the local store identifies an entry by (goalId, ts) — a composite
 * key. The API identifies by Mongo's _id. removeEntry(goalId, ts)
 * needs a two-step translation: list entries for the goal, find the
 * one whose ts matches, DELETE by id. Two API calls but only fires
 * on user-initiated deletes which are rare.
 *
 * For clearGoalEntries, same translation pattern (list-then-delete-each).
 * Could be a single bulk endpoint, but the simpler API surface from M4
 * keeps everything per-entry. Acceptable cost given how rare clear is.
 *
 * Append is straightforward: POST /goal-inputs with the entry's shape
 * (the local validator already accepted it).
 */

import { apiDelete, apiGet, apiPost } from "@/lib/api-client";

const FAIL_LOG_PREFIX = "[goal-inputs-sync]";

function isAuthError(err) {
  return err?.code === "unauthenticated" || err?.code === "totp_required";
}

export async function mirrorAppendEntry(entry) {
  if (!entry || !entry.goalId || typeof entry.ts !== "number") return;
  const r = await apiPost("/goal-inputs", {
    goalId: entry.goalId,
    value: entry.value,
    note: entry.note ?? null,
    ts: new Date(entry.ts).toISOString(),
    source: "manual",
  });
  if (r.ok) return;
  if (isAuthError(r.error)) return;
  // eslint-disable-next-line no-console
  console.warn(
    `${FAIL_LOG_PREFIX} append failed:`,
    r.error?.code,
    r.error?.message,
  );
}

/**
 * Two-step: list this goal's entries from the API, find the one whose
 * ts matches the local removal, DELETE by id. Silently no-op if the
 * API never had that entry (could happen with offline-then-online
 * sequences).
 */
export async function mirrorRemoveEntry(goalId, ts) {
  if (!goalId || typeof ts !== "number") return;
  const list = await apiGet(`/goal-inputs?goalId=${encodeURIComponent(goalId)}`);
  if (!list.ok) {
    if (isAuthError(list.error)) return;
    // eslint-disable-next-line no-console
    console.warn(
      `${FAIL_LOG_PREFIX} remove (list) failed:`,
      list.error?.code,
      list.error?.message,
    );
    return;
  }
  const entries = Array.isArray(list.data?.entries) ? list.data.entries : [];
  const match = entries.find((e) => new Date(e.ts).getTime() === ts);
  if (!match) return; // API doesn't have it; nothing to do
  const del = await apiDelete(`/goal-inputs/${encodeURIComponent(match.id)}`);
  if (del.ok) return;
  if (isAuthError(del.error)) return;
  // eslint-disable-next-line no-console
  console.warn(
    `${FAIL_LOG_PREFIX} remove (delete) failed:`,
    del.error?.code,
    del.error?.message,
  );
}

/** Clear all entries for one goal — list then delete each. Wasteful
 *  if a goal has hundreds of entries, but `clear` is a rare user
 *  action. Bulk endpoint can land later if needed. */
export async function mirrorClearGoal(goalId) {
  if (!goalId) return;
  const list = await apiGet(`/goal-inputs?goalId=${encodeURIComponent(goalId)}&limit=2000`);
  if (!list.ok) {
    if (isAuthError(list.error)) return;
    return;
  }
  const entries = Array.isArray(list.data?.entries) ? list.data.entries : [];
  // Parallel — these are independent deletes; failures are absorbed
  // individually so a single bad row doesn't block the rest.
  await Promise.all(
    entries.map((e) =>
      apiDelete(`/goal-inputs/${encodeURIComponent(e.id)}`).catch(() => null),
    ),
  );
}

/**
 * Pull all entries for the current user from the API, group by
 * goalId, dedupe against local by ts, and write back. The merge
 * helper lives in inputs-store.js — it owns the storage shape.
 */
export async function pullInputsFromApi(mergeRemote) {
  if (typeof mergeRemote !== "function") return 0;
  const r = await apiGet("/goal-inputs?limit=2000");
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
  const entries = Array.isArray(r.data?.entries) ? r.data.entries : [];
  // Local store expects ts as epoch ms.
  const normalised = entries.map((e) => ({
    goalId: e.goalId,
    ts: new Date(e.ts).getTime(),
    value: e.value,
    note: e.note ?? undefined,
  }));
  mergeRemote(normalised);
  return normalised.length;
}

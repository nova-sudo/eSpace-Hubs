"use client";

/**
 * Mirror-mode sync for the L1/L2 goal tree.
 *
 * Different shape from the per-goal stores: goals is ONE document, and
 * every local mutation (add/update/remove L1 or L2, clearGoals,
 * replaceGoals, appendGoals) ends with a writeAll(state). Rather than
 * mirroring every mutation individually we attach the mirror to
 * writeAll itself — one PUT /goals after every local write. The tree
 * is small (~5-30 L1s, well under 100KB) so re-PUTing on every mutation
 * is fine.
 *
 * Pull side uses a separate `_replaceLocalNoMirror` path on the store
 * to break the round-trip loop (otherwise pull → writeAll → PUT →
 * pull → ...).
 *
 * The server's Zod schema accepts only `{l1s}` — schemaVersion is
 * implicit and updatedAt + cycleId are server-set. So we send only
 * the l1s array on PUT.
 */

import { apiGet, apiPut } from "@/lib/api-client";

const FAIL_LOG_PREFIX = "[goals-sync]";

function isAuthError(err) {
  return err?.code === "unauthenticated" || err?.code === "totp_required";
}

export async function mirrorPutTree(state) {
  if (!state || !Array.isArray(state.l1s)) return;
  const r = await apiPut("/goals", { l1s: state.l1s });
  if (r.ok) return;
  if (isAuthError(r.error)) return;
  // eslint-disable-next-line no-console
  console.warn(
    `${FAIL_LOG_PREFIX} PUT /goals failed:`,
    r.error?.code,
    r.error?.message,
  );
}

/**
 * Pull /goals and replace local. The replace callback should NOT
 * fire another mirror PUT — use the store's `_replaceLocalNoMirror`
 * path.
 *
 * Returns the L1 count merged, or 0 on auth failure / empty server.
 */
export async function pullGoalsFromApi(replaceLocal) {
  if (typeof replaceLocal !== "function") return 0;
  const r = await apiGet("/goals");
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
  // Server returns {schemaVersion, l1s, cycleId, updatedAt}. Local
  // store only persists {schemaVersion, l1s} — drop the rest.
  const l1s = Array.isArray(r.data?.l1s) ? r.data.l1s : [];
  if (l1s.length === 0) return 0;
  replaceLocal({ l1s });
  return l1s.length;
}

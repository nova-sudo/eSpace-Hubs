"use client";

/**
 * Mirror-mode sync helpers for the snapshot stream.
 *
 * Same pattern as grading-sync.js — local writes always win for UI
 * feedback, API copies follow asynchronously, auth failures absorbed
 * silently.
 *
 * One nuance specific to snapshots: the "manual wins over auto" rule.
 * Both the local store (saveSnapshot in snapshots-store.js) AND the
 * server (POST /api/v1/snapshots) enforce it independently. The
 * mirror just sends what the local side accepted; if the server's
 * existing record is manual and incoming is auto, the server returns
 * precedence: "manual_kept" and we ignore that — local is already in
 * sync with the local rule.
 *
 * Pull semantics:
 *   - GET /snapshots with limit:250 (well above the local cap of 60)
 *     so we never miss a recent snapshot from another device.
 *   - For each row, dispatch saveLocal() which runs the local
 *     manual-wins precedence again. Local stays consistent with itself.
 *   - 60-snapshot local cap drops the OLDEST on overflow, so merging
 *     older API rows into a full local buffer is a no-op.
 */

import { apiGet, apiPost, apiPatch } from "@/lib/api-client";

const FAIL_LOG_PREFIX = "[snapshots-sync]";

/** Map an API snapshot row → local-store shape. The store's
 *  normaliseSnapshot() will run again on the way in, so a few
 *  redundant defaults here don't matter. */
function fromApi(s) {
  return {
    week: s.week,
    capturedAt: s.capturedAt, // ISO string already
    capturedBy: s.capturedBy,
    merged: s.merged,
    reviews: s.reviews,
    turnaround: s.turnaround,
    linkage: s.linkage,
    rounds: s.rounds,
    note: s.note,
    goalReadings: s.goalReadings,
    partial: s.partial,
    gaps: s.gaps,
  };
}

/** Map local snapshot → API request body. */
function toApi(s) {
  return {
    week: s.week,
    capturedAt: s.capturedAt ?? undefined,
    capturedBy: s.capturedBy === "auto" ? "auto" : "manual",
    merged: s.merged ?? 0,
    reviews: s.reviews ?? 0,
    turnaround: s.turnaround ?? 0,
    linkage: s.linkage ?? 0,
    rounds: s.rounds ?? 0,
    note: s.note ?? "",
    goalReadings: s.goalReadings ?? {},
    partial: !!s.partial,
    gaps: Array.isArray(s.gaps) ? s.gaps : [],
  };
}

export async function mirrorSaveSnapshot(snapshot) {
  if (!snapshot || !snapshot.week) return;
  const r = await apiPost("/snapshots", toApi(snapshot));
  if (r.ok) return;
  if (r.error?.code === "unauthenticated" || r.error?.code === "totp_required") return;
  // eslint-disable-next-line no-console
  console.warn(
    `${FAIL_LOG_PREFIX} save failed:`,
    r.error?.code,
    r.error?.message,
  );
}

export async function mirrorPatchSnapshotNote(week, note) {
  if (!week) return;
  const r = await apiPatch(`/snapshots/${encodeURIComponent(week)}`, { note });
  if (r.ok) return;
  // 404 = snapshot doesn't exist on the server yet (user typed a note
  // before the snapshot itself synced). Mirror save will follow shortly;
  // not an error worth surfacing.
  if (r.status === 404) return;
  if (r.error?.code === "unauthenticated" || r.error?.code === "totp_required") return;
  // eslint-disable-next-line no-console
  console.warn(
    `${FAIL_LOG_PREFIX} patch note failed:`,
    r.error?.code,
    r.error?.message,
  );
}

/**
 * Pull from /snapshots and apply each to the local store via the
 * supplied callback (saveSnapshot). The local store's
 * normaliseSnapshot + manual-wins rule runs on each row, so the
 * merge is idempotent.
 *
 * Returns the count merged so the caller can log / surface a toast.
 */
export async function pullSnapshotsFromApi(saveLocal) {
  if (typeof saveLocal !== "function") return 0;
  // Pull a generous window — the local store caps at 60 weeks anyway.
  // The API's max is 250 (per the /snapshots listQuerySchema).
  const r = await apiGet("/snapshots?limit=250");
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
  const snapshots = Array.isArray(r.data?.snapshots) ? r.data.snapshots : [];
  // Apply newest-first so when the buffer fills, oldest API rows are
  // the ones that get dropped — keeps the most-recent picture intact.
  // API returns capturedAt-desc already; iterate as-is.
  for (const s of snapshots) {
    saveLocal(fromApi(s));
  }
  return snapshots.length;
}

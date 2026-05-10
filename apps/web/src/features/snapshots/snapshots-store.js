/**
 * localStorage-backed snapshot history. A snapshot is a frozen copy of the
 * user's headline metrics + per-goal readings for one Sun-anchored work
 * week (Sun → Thu, captured Thu EOD).
 *
 * Schema (v2 — extended for goal readings):
 *   {
 *     week:       "W16",                 // Sun-anchored week label
 *     capturedAt: "2026-04-22T...",      // ISO date (Thu EOD or first
 *                                        //   visit after that)
 *     capturedBy: "auto" | "manual",     // who pressed the button
 *     // ── headline metrics (v1 fields, still here, still authoritative)
 *     merged:     8,                     // MRs merged that week
 *     reviews:    47,                    // comments-given count
 *     turnaround: 14,                    // median hours open→merge
 *     linkage:    94,                    // % linked to a tracker key
 *     rounds:     1.6,                   // avg reviewer comments per MR
 *     note:       "Idempotency patch …", // free-text
 *     // ── v2 fields ────────────────────────────────────────────────
 *     goalReadings: {                    // per-goal frozen reading
 *       [goalId]: {
 *         cadence:         "weekly" | "monthly" | "quarterly" | …,
 *         cadenceWindow:   "W16-2026" | "2026-04" | "2026-Q2",
 *         weekContribution: number | null,  // what this week added
 *         cumulative:      number | null,   // running total within window
 *         target:          { op, value } | null,
 *         windowMet:       boolean | null,  // sticky for >=, recompute for <=
 *         onPace:          boolean | null,  // for cumulative goals
 *       }
 *     },
 *     partial:    boolean,               // true if some sources unavailable
 *     gaps:       string[],              // names of missing data sources
 *   }
 *
 * Backwards-compat: snapshots written under v1 still load — readers
 * default missing v2 fields to safe values (`capturedBy: "manual"`,
 * `goalReadings: {}`, etc.). New writes carry the full v2 shape.
 */

import {
  mirrorPatchSnapshotNote,
  mirrorSaveSnapshot,
} from "./snapshots-sync";

const STORAGE_KEY = "espace-devhub:snapshots";
const CHANGE_EVENT = "snapshots:change";

/**
 * Normalise a snapshot to the v2 shape. Used at read AND write time so
 * we never have to special-case "v1 vs v2" further down the stack.
 */
function normaliseSnapshot(s) {
  if (!s || typeof s !== "object") return null;
  return {
    week: typeof s.week === "string" ? s.week : "",
    capturedAt: typeof s.capturedAt === "string" ? s.capturedAt : null,
    capturedBy: s.capturedBy === "auto" ? "auto" : "manual",
    merged: Number.isFinite(s.merged) ? s.merged : 0,
    reviews: Number.isFinite(s.reviews) ? s.reviews : 0,
    turnaround: Number.isFinite(s.turnaround) ? s.turnaround : 0,
    linkage: Number.isFinite(s.linkage) ? s.linkage : 0,
    rounds: Number.isFinite(s.rounds) ? s.rounds : 0,
    note: typeof s.note === "string" ? s.note : "",
    goalReadings:
      s.goalReadings && typeof s.goalReadings === "object"
        ? s.goalReadings
        : {},
    partial: Boolean(s.partial),
    gaps: Array.isArray(s.gaps) ? s.gaps : [],
  };
}

export function readSnapshots() {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(raw)
      ? raw.map(normaliseSnapshot).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function writeAll(next) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Append a snapshot. Replaces any existing snapshot for the same week
 * UNLESS the existing one is manual and the incoming is auto — manual
 * always wins (you don't want the auto-snapshotter clobbering a hand-
 * captured note).
 */
export function saveSnapshot(snapshot) {
  const incoming = normaliseSnapshot(snapshot);
  if (!incoming || !incoming.week) return;
  const all = readSnapshots();
  const existing = all.find((s) => s.week === incoming.week);
  if (
    existing &&
    existing.capturedBy === "manual" &&
    incoming.capturedBy === "auto"
  ) {
    // Don't overwrite a user's manual capture with an auto one. The
    // auto-snapshotter will leave it alone next time too — the week is
    // already on record.
    return;
  }
  const filtered = all.filter((s) => s.week !== incoming.week);
  const next = [incoming, ...filtered]
    .sort((a, b) => b.week.localeCompare(a.week))
    .slice(0, 60); // ~14mo cap (60 weeks)
  writeAll(next);
  // Mirror to API — fire-and-forget. The server enforces its OWN
  // manual-wins rule, so an auto write that should be ignored gets
  // ignored on both sides independently. Local already wrote what
  // it accepted; the mirror is just keeping the server in sync.
  void mirrorSaveSnapshot(incoming);
}

export function updateSnapshotNote(week, note) {
  const all = readSnapshots();
  const next = all.map((s) => (s.week === week ? { ...s, note } : s));
  writeAll(next);
  // Mirror note edits through PATCH — much smaller than re-sending
  // the whole snapshot, and matches the existing patch endpoint shape.
  void mirrorPatchSnapshotNote(week, note);
}

export function clearSnapshots() {
  writeAll([]);
}

export const SNAPSHOTS_CHANGE_EVENT = CHANGE_EVENT;

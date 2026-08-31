"use client";

/**
 * Ephemeral tier-transition store (F9 G0.5) — the tab-local "you moved
 * a rung" moments the fill-feedback loop records and TierDeltaBadge
 * renders. Deliberately in-memory only (BR-6/BR-10): persisting would
 * re-celebrate stale moves on reload, and the moment belongs to the tab
 * that earned it. Modeled on lib/jobs-store.js, NOT the localStorage-
 * backed verdict cache.
 *
 * Shape: { [goalId]: { from, to, direction, steps, at } }.
 *
 * Also hosts the FILL-INTENT registry (G1.1/G1.3): call sites mark an
 * explicit user fill; useGoalTier's grading effect peeks it to bypass
 * the once-per-day throttle for that fill only. Short TTL so a stale
 * intent can't force-grade passive drift minutes later.
 */

import { tierDelta } from "./tier-diff";

const CHANGE_EVENT = "tier-transitions:change";
/** A record older than this reads as gone even without an explicit clear. */
const RECORD_TTL_MS = 60_000;
/** Fill intent must be consumed quickly or it expires. */
const FILL_INTENT_TTL_MS = 10_000;

let state = {};
let fillIntent = new Map(); // goalId -> markedAt
let tick = 0;

function notify() {
  tick += 1;
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}

/**
 * Record a rung move. Runs tierDelta internally — no-ops (returns null,
 * writes nothing) on first-grade/no-op/unknown inputs, on `hold` (a
 * rubric/scorecard mid-load window must never celebrate — G2.3), and
 * idempotently when a live record for the same (goalId, to) already
 * exists (double-mounted hooks race to record the same move — G1.5/G2.4:
 * one record, one notify).
 */
export function recordTierTransition(goalId, from, to, { hold = false } = {}) {
  if (!goalId || hold) return null;
  const delta = tierDelta(from, to);
  if (!delta) return null;
  const existing = state[goalId];
  if (
    existing &&
    existing.to === to &&
    Date.now() - existing.at <= RECORD_TTL_MS
  ) {
    return existing; // same move already recorded — idempotent
  }
  const entry = { ...delta, at: Date.now() };
  state = { ...state, [goalId]: entry };
  notify();
  return entry;
}

/** Current transition for a goal, or null (TTL applied at read time). */
export function readTierTransition(goalId) {
  const entry = goalId ? state[goalId] : null;
  if (!entry) return null;
  if (Date.now() - entry.at > RECORD_TTL_MS) return null;
  return entry;
}

export function clearTierTransition(goalId) {
  if (!goalId || !(goalId in state)) return;
  const { [goalId]: _dropped, ...rest } = state;
  state = rest;
  notify();
}

/* ─── fill intent (G1.1 → G1.3) ─── */

export function markFillIntent(goalId) {
  if (!goalId) return;
  fillIntent.set(goalId, Date.now());
}

/** True when a live (un-expired) explicit-fill intent exists. */
export function peekFillIntent(goalId) {
  const at = goalId ? fillIntent.get(goalId) : undefined;
  if (at == null) return false;
  if (Date.now() - at > FILL_INTENT_TTL_MS) {
    fillIntent.delete(goalId);
    return false;
  }
  return true;
}

export function consumeFillIntent(goalId) {
  if (!goalId) return;
  fillIntent.delete(goalId);
}

/* ─── useSyncExternalStore plumbing ─── */

export function subscribeTierTransitions(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}
export function getTierTransitionsSnapshot() {
  return tick;
}
export function getTierTransitionsServerSnapshot() {
  return 0;
}

/** Wipe everything — a new user must never see the prior user's move. */
export function resetTierTransitions() {
  state = {};
  fillIntent = new Map();
  notify();
}

if (typeof window !== "undefined") {
  window.addEventListener("auth:user-storage-cleared", resetTierTransitions);
}

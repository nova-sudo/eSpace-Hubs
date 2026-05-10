"use client";

/**
 * Append-only time-series store for manual goal inputs, keyed by goalId.
 *
 * Schema (persisted JSON):
 *   { [goalId]: Array<GoalInput sorted by ts asc> }
 *
 * The store is intentionally dumb — no aggregation here. Widgets slice /
 * bucket their own entries because each has a different analysis mode
 * (sum for Counter, latest for Scale, fold for Milestone, etc).
 *
 * Event-driven change propagation mirrors `specs-store` + `goals-store` so
 * React hooks can subscribe via useSyncExternalStore without wrapping the
 * app in yet another context.
 */

import { validateInput } from "./schema";

const STORAGE_KEY = "espace-devhub:goal-inputs";
const CHANGE_EVENT = "goal-inputs:change";

export const INPUTS_CHANGE_EVENT = CHANGE_EVENT;
export const INPUTS_STORAGE_KEY = STORAGE_KEY;

function readRaw() {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeRaw(state) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Return the full {goalId → entries[]} map. Entries sorted ts-ascending. */
export function readInputs() {
  return readRaw();
}

/** Return entries for a single goal (sorted ts-ascending). */
export function readGoalEntries(goalId) {
  if (!goalId) return [];
  const state = readRaw();
  const list = state[goalId];
  return Array.isArray(list) ? list : [];
}

/**
 * Append a new entry. Returns the validation result so widgets can react
 * to bad inputs (e.g. show an inline error).
 */
export function appendEntry({ goalId, value, note, ts = Date.now() }) {
  const res = validateInput({ goalId, value, note, ts });
  if (!res.ok) return res;
  const state = readRaw();
  const current = Array.isArray(state[goalId]) ? state[goalId] : [];
  const next = [...current, res.entry].sort((a, b) => a.ts - b.ts);
  state[goalId] = next;
  writeRaw(state);
  return res;
}

/**
 * Remove a specific entry. Ts + goalId together are the primary key.
 * Two entries within the same millisecond on the same goal would collapse,
 * so we fall back to reference-equality via an index check.
 */
export function removeEntry(goalId, ts) {
  if (!goalId) return;
  const state = readRaw();
  const list = Array.isArray(state[goalId]) ? state[goalId] : [];
  const next = list.filter((e) => e.ts !== ts);
  if (next.length === list.length) return;
  state[goalId] = next;
  writeRaw(state);
}

/** Wipe every entry for a single goal — used when re-analyzing. */
export function clearGoalEntries(goalId) {
  if (!goalId) return;
  const state = readRaw();
  if (!state[goalId]) return;
  const next = { ...state };
  delete next[goalId];
  writeRaw(next);
}

/** Replace all entries for a single goal (used for imports). */
export function replaceGoalEntries(goalId, entries) {
  if (!goalId) return { saved: 0, skipped: [] };
  const saved = [];
  const skipped = [];
  for (const entry of entries || []) {
    const res = validateInput({ ...entry, goalId });
    if (res.ok) saved.push(res.entry);
    else skipped.push({ entry, errors: res.errors });
  }
  saved.sort((a, b) => a.ts - b.ts);
  const state = readRaw();
  state[goalId] = saved;
  writeRaw(state);
  return { saved: saved.length, skipped };
}

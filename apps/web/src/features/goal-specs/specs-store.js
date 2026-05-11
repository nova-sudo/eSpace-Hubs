"use client";

/**
 * Persistence layer for classified GoalSpecs.
 *
 * Mirrors the pattern used by `goals-store.js`:
 *   - localStorage-backed
 *   - dispatches a named CustomEvent on writes so multiple hooks can
 *     `useSyncExternalStore` without sharing React context
 *   - pure functions; no React
 *
 * Each spec keys off `goalId`. Saving the same goalId overwrites (the most
 * recent classification wins — simpler than maintaining a history). Callers
 * that want diff tracking should snapshot specs separately.
 */

import { validateSpec } from "@espace-devhub/shared/goal-specs";
import { mirrorRemoveSpec, mirrorSaveSpec } from "./specs-sync";

const STORAGE_KEY = "espace-devhub:goal-specs";
const CHANGE_EVENT = "goal-specs:change";

export const SPECS_CHANGE_EVENT = CHANGE_EVENT;
export const SPECS_STORAGE_KEY = STORAGE_KEY;

function readRaw() {
  if (typeof window === "undefined") return { specs: {}, lastAnalyzedAt: 0 };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!parsed || typeof parsed !== "object") {
      return { specs: {}, lastAnalyzedAt: 0 };
    }
    return {
      specs: parsed.specs && typeof parsed.specs === "object" ? parsed.specs : {},
      lastAnalyzedAt: Number(parsed.lastAnalyzedAt) || 0,
    };
  } catch {
    return { specs: {}, lastAnalyzedAt: 0 };
  }
}

function writeRaw(state) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Read the whole store. Validator runs lazily at access time — we don't
 * prune invalid specs on read so callers can surface "widget error" chips
 * rather than silently swallowing stale shapes.
 */
export function readSpecs() {
  return readRaw();
}

/**
 * Return a plain object `{ [goalId]: spec }` for just the valid specs.
 * Use `readSpecs()` when you need to surface validation errors.
 */
export function readValidSpecs() {
  const state = readRaw();
  const out = {};
  for (const [goalId, value] of Object.entries(state.specs)) {
    const res = validateSpec(value);
    if (res.ok) out[goalId] = res.spec;
  }
  return out;
}

/**
 * Save a spec, replacing any existing one for the same goalId. Validates
 * before write and returns the validation result so the caller can report
 * failures (e.g. from the classifier) upstream.
 */
export function saveSpec(spec) {
  const res = validateSpec(spec);
  if (!res.ok) return res;
  const state = readRaw();
  state.specs = { ...state.specs, [res.spec.goalId]: res.spec };
  writeRaw(state);
  // Mirror — server's validateSpec uses the same algorithm so a
  // locally-accepted spec passes server validation.
  void mirrorSaveSpec(res.spec);
  return res;
}

/** Remove a single spec by goalId. No-op when absent. */
export function removeSpec(goalId) {
  const state = readRaw();
  if (!state.specs[goalId]) return;
  const next = { ...state.specs };
  delete next[goalId];
  state.specs = next;
  writeRaw(state);
  void mirrorRemoveSpec(goalId);
}

/** Wipe all specs (used by "Re-analyze all" after the user confirms). */
export function clearSpecs() {
  writeRaw({ specs: {}, lastAnalyzedAt: 0 });
}

/** Record the completion timestamp of the latest full-tree analysis. */
export function markAnalyzedAt(ts = Date.now()) {
  const state = readRaw();
  state.lastAnalyzedAt = ts;
  writeRaw(state);
}

/**
 * Bulk replace — used by import / restore flows. Each incoming value is
 * validated; invalid ones are skipped and collected in `skipped`.
 */
export function replaceSpecs(map) {
  const entries = Object.entries(map || {});
  const specs = {};
  const skipped = [];
  for (const [goalId, value] of entries) {
    const res = validateSpec({ ...value, goalId });
    if (res.ok) specs[goalId] = res.spec;
    else skipped.push({ goalId, errors: res.errors });
  }
  writeRaw({ specs, lastAnalyzedAt: Date.now() });
  return { saved: Object.keys(specs).length, skipped };
}

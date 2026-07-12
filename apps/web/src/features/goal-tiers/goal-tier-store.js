"use client";

/**
 * AI goal-tier verdict cache (Phase 2).
 *
 * Caches the result of `POST /api/v1/ai/grade-goal-tier` per goal,
 * keyed by a `key` the hook computes from (day + hash of tiers + current
 * data). We re-grade at most once per day per goal — or sooner when the
 * tiers or the goal's live data change. localStorage-backed so it
 * survives reloads; reset on auth transition.
 *
 * NOT server-persisted: a tier verdict is a cheap derived read of the
 * goal's tiers + current metrics, so a per-device daily cache is enough
 * (mirrors the review-timing cache, not the grading-verdicts
 * collection). The AI call is the expensive part — caching avoids
 * re-spending tokens on every page view.
 */

import { fetchWithRateLimitRetry } from "@/lib/rate-limit";

const STORAGE_KEY = "espace-devhub:goal-tiers";
const CHANGE_EVENT = "goal-tiers:change";

/** { [goalId]: { tier, reasoning, confidence, key } } */
let state = {};
let tick = 0;
let loaded = false;
const inflight = new Set();
// One-shot server hydration: seeds the local cache from the durable DB store
// so a fresh device / cleared localStorage doesn't re-grade unchanged goals.
let hydrated = false;
let hydrating = false;

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") state = parsed;
  } catch {
    /* ignore corrupt cache */
  }
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota / disabled — fine, recomputes next load */
  }
}

function notify() {
  tick += 1;
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}

export function subscribeGoalTiers(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}
export function getGoalTiersSnapshot() {
  return tick;
}
export function getGoalTiersServerSnapshot() {
  return 0;
}

/** Current cached verdict for a goal (any key), or null. */
export function readGoalTier(goalId) {
  load();
  return (goalId && state[goalId]) || null;
}

/**
 * Grade a goal's tier unless we already have a fresh verdict for `key`.
 * Idempotent: skips when the stored verdict matches `key` or a grade is
 * already in flight for the goal. `force` re-grades regardless. On a
 * rate-limit / error the prior verdict is left intact (no failure cached).
 */
export async function gradeGoalTier({
  goalId,
  goalTitle,
  tiers,
  currentData,
  key,
  aiProvider,
  force = false,
}) {
  load();
  if (!goalId || !tiers || !key) return;
  if (!force) {
    const existing = state[goalId];
    if (existing && existing.key === key) return;
    if (inflight.has(goalId)) return;
  }
  inflight.add(goalId);
  try {
    const res = await fetchWithRateLimitRetry(
      "/api/v1/ai/grade-goal-tier",
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-ai-provider": aiProvider || "mistral",
        },
        body: JSON.stringify({
          goalTitle: goalTitle || "",
          tiers,
          currentData: currentData || "",
          provider: aiProvider || undefined,
          // Durable-cache coordinates: the server returns a persisted verdict
          // for a matching hash instead of re-calling the model, and persists
          // fresh grades under (goalId, tierHash). `force` bypasses it.
          goalId,
          tierHash: key,
          force: force || undefined,
        }),
      },
      { provider: "ai" },
    );
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.verdict?.tier) {
      state = { ...state, [goalId]: { ...body.verdict, key } };
      persist();
      notify();
    }
  } catch {
    /* network / abort — keep any prior verdict */
  } finally {
    inflight.delete(goalId);
  }
}

/**
 * Write a locally-computed verdict (a deterministic numeric grade, or the
 * "awaiting data" state) WITHOUT an API call — same cache shape + persistence
 * as the AI path. Idempotent: no-ops when the stored verdict for this key is
 * already equal, so callers can safely invoke it from a render effect without
 * looping.
 */
export function setGoalTierVerdict(goalId, verdict, key) {
  load();
  if (!goalId || !verdict || !key) return;
  const existing = state[goalId];
  if (
    existing &&
    existing.key === key &&
    existing.tier === verdict.tier &&
    Boolean(existing.awaiting) === Boolean(verdict.awaiting)
  ) {
    return; // already current — avoid a redundant notify/re-render loop
  }
  state = { ...state, [goalId]: { ...verdict, key } };
  persist();
  notify();
}

/**
 * Seed the local cache from the durable server store, once per session. Merges
 * ONLY goals we don't already hold locally — a local entry is at least as fresh
 * (it's written on every grade and may carry a newer hash for data changed on
 * this device since the server last saw it). Safe to call from many mounts: the
 * `hydrated`/`hydrating` guards collapse them to a single request, and a 401 /
 * network error leaves it un-hydrated so it retries once auth settles.
 */
export async function hydrateGoalTiers() {
  if (hydrated || hydrating || typeof window === "undefined") return;
  hydrating = true;
  load();
  try {
    const res = await fetch("/api/v1/ai/goal-tier-verdicts", {
      credentials: "include",
    });
    if (res.status === 401) return; // not authed yet — retry on a later mount
    hydrated = true;
    if (!res.ok) return;
    const body = await res.json().catch(() => ({}));
    const rows = Array.isArray(body?.verdicts) ? body.verdicts : [];
    let changed = false;
    for (const r of rows) {
      if (!r?.goalId || !r?.tierHash || !r?.verdict) continue;
      if (state[r.goalId]) continue; // keep the local (≥ as fresh) entry
      state = { ...state, [r.goalId]: { ...r.verdict, key: r.tierHash } };
      changed = true;
    }
    if (changed) {
      persist();
      notify();
    }
  } catch {
    /* offline — the POST grade path still consults the server cache */
  } finally {
    hydrating = false;
  }
}

export function resetGoalTiers() {
  state = {};
  loaded = true;
  hydrated = false;
  hydrating = false;
  notify();
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("auth:user-storage-cleared", resetGoalTiers);
}

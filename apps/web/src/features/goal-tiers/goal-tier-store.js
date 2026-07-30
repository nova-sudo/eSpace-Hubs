"use client";

/**
 * AI goal-tier verdict cache (Phase 2).
 *
 * Caches the result of `POST /api/v1/ai/grade-goal-tier` per goal. Each
 * cached verdict carries a `criteriaKey` (hash of the tier criteria + numeric
 * ladder), a data `key` (hash of the live reading / prose), and a `gradedDay`
 * (local YYYY-MM-DD). The hook re-grades qualitative goals at most once per day
 * — or immediately when the criteria change (edit / re-analyze) or the user
 * hits "re-grade" (force). localStorage-backed so it survives reloads; reset on
 * auth transition.
 *
 * NOT server-persisted: a tier verdict is a cheap derived read of the
 * goal's tiers + current metrics, so a per-device daily cache is enough
 * (mirrors the review-timing cache, not the grading-verdicts
 * collection). The AI call is the expensive part — caching avoids
 * re-spending tokens on every page view.
 */

import { fetchWithRateLimitRetry } from "@/lib/rate-limit";
import { startJob, endJob } from "@/lib/jobs-store";

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
 * Grade a goal's tier unless it's already been graded today against the same
 * criteria. Idempotent: skips when the stored verdict is same-criteria +
 * same-day, or a grade is already in flight for the goal. `force` re-grades
 * regardless (the manual "re-grade" button + window-fill path). On a
 * rate-limit / error the prior verdict is left intact (no failure cached).
 */
export async function gradeGoalTier({
  goalId,
  goalTitle,
  tiers,
  currentData,
  key,
  criteriaKey,
  gradedDay,
  aiProvider,
  force = false,
}) {
  load();
  if (!goalId || !tiers || !key) return;
  if (!force) {
    const existing = state[goalId];
    // Already graded today against these exact criteria — the verdict is a
    // pure function of (criteria, data), so re-running the model would just
    // reproduce it. The hook's effect is the primary throttle; this guards the
    // store directly. (The `key` still flows to the server as the durable-cache
    // coordinate, but it no longer gates the CLIENT re-grade — that's what used
    // to churn on every live-reading change.)
    if (
      existing &&
      criteriaKey != null &&
      gradedDay != null &&
      existing.criteriaKey === criteriaKey &&
      existing.gradedDay === gradedDay
    ) {
      return;
    }
    if (inflight.has(goalId)) return;
  }
  inflight.add(goalId);
  // Surface the grade in the shell "running jobs" toast. The request already
  // survives navigation (it writes straight into this module store), so this
  // just makes it visible — and keyed per goal so the toast can count them.
  startJob(`grading:${goalId}`, { kind: "grading", label: goalTitle || "" });
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
      state = {
        ...state,
        [goalId]: { ...body.verdict, key, criteriaKey, gradedDay },
      };
      persist();
      notify();
    }
  } catch {
    /* network / abort — keep any prior verdict */
  } finally {
    inflight.delete(goalId);
    endJob(`grading:${goalId}`);
  }
}

/**
 * Write a locally-computed verdict (a deterministic numeric grade, or the
 * "awaiting data" state) WITHOUT an API call — same cache shape + persistence
 * as the AI path. Idempotent: no-ops when the stored verdict for this key is
 * already equal, so callers can safely invoke it from a render effect without
 * looping.
 */
export function setGoalTierVerdict(goalId, verdict, key, criteriaKey) {
  load();
  if (!goalId || !verdict || !key) return;
  const existing = state[goalId];
  if (
    existing &&
    existing.key === key &&
    existing.criteriaKey === criteriaKey &&
    existing.tier === verdict.tier &&
    Boolean(existing.awaiting) === Boolean(verdict.awaiting)
  ) {
    return; // already current — avoid a redundant notify/re-render loop
  }
  // Stamp criteriaKey (so qualitative "awaiting" verdicts validate on the same
  // basis the hook reads) but NOT gradedDay — a deterministic numeric grade or
  // an "awaiting" placeholder must never count as the day's AI grade, or the
  // first real grade of the day would be throttled away.
  state = {
    ...state,
    [goalId]: { ...verdict, key, ...(criteriaKey != null ? { criteriaKey } : {}) },
  };
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

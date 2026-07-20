"use client";

/**
 * Manager-verdict cache (dev side). Holds the authoritative achievement
 * tiers a manager has hand-set on THIS user's goals, hydrated once from
 * GET /api/v1/goal-verdicts/mine. A manager verdict OUTRANKS the AI
 * verdict wherever a goal's tier is shown — `useGoalTier` and
 * `readCappedGoalTier` short-circuit to it.
 *
 * Uses raw fetch (not apiGet) so a pre-auth 401 doesn't trip the global
 * login redirect — mirrors goal-tier-store's hydrate. Reset on auth
 * transition so one user's grades never leak to the next.
 */

/** { [goalId]: { tier, note, gradedByName, gradedAt } } */
let state = {};
let tick = 0;
let hydrated = false;
let hydrating = false;
const CHANGE_EVENT = "manager-verdicts:change";

function notify() {
  tick += 1;
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}

export function subscribeManagerVerdicts(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}
export function getManagerVerdictsSnapshot() {
  return tick;
}
export function getManagerVerdictsServerSnapshot() {
  return 0;
}

/** The manager verdict for a goal, or null. */
export function readManagerVerdict(goalId) {
  return (goalId && state[goalId]) || null;
}

/** Seed the cache from the server, once per session. */
export async function hydrateManagerVerdicts() {
  if (hydrated || hydrating || typeof window === "undefined") return;
  hydrating = true;
  try {
    const res = await fetch("/api/v1/goal-verdicts/mine", {
      credentials: "include",
    });
    if (res.status === 401) return; // not authed yet — retry on a later mount
    hydrated = true;
    if (!res.ok) return;
    const body = await res.json().catch(() => ({}));
    const rows = Array.isArray(body?.verdicts) ? body.verdicts : [];
    const next = {};
    for (const v of rows) {
      if (!v?.goalId || !v?.tier) continue;
      next[v.goalId] = {
        tier: v.tier,
        note: v.note ?? "",
        gradedByName: v.gradedByName ?? "",
        gradedAt: v.gradedAt ?? null,
      };
    }
    state = next;
    notify();
  } catch {
    /* offline — falls back to the AI verdict until a later hydrate */
  } finally {
    hydrating = false;
  }
}

export function resetManagerVerdicts() {
  state = {};
  hydrated = false;
  hydrating = false;
  notify();
}

if (typeof window !== "undefined") {
  window.addEventListener("auth:user-storage-cleared", resetManagerVerdicts);
}

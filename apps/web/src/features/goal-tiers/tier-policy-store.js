"use client";

/**
 * Manager tier-policy cache (dev side). Holds the manager-authored
 * achievement-tier CRITERIA that govern this user's own goals, hydrated
 * once from GET /api/v1/tier-policies/mine. A policy is AUTHORED by Goal
 * Code (l1.code or l2.code, org-wide) but the server resolves the Code →
 * goalId join
 * for us, so this store — like manager-verdict-store — is simply keyed by
 * goalId. `finalTiers` and `cadenceTiers` are read independently; neither
 * is derived from or compared against the other.
 *
 * Uses raw fetch (not apiGet) so a pre-auth 401 doesn't trip the global
 * login redirect — mirrors manager-verdict-store's hydrate. Reset on auth
 * transition so one user's policies never leak to the next.
 */

/** { [goalId]: { code, finalTiers, cadenceTiers } } */
let state = {};
let tick = 0;
let hydrated = false;
let hydrating = false;
const CHANGE_EVENT = "tier-policies:change";

function notify() {
  tick += 1;
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}

export function subscribeTierPolicies(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}
export function getTierPoliciesSnapshot() {
  return tick;
}
export function getTierPoliciesServerSnapshot() {
  return 0;
}

/** The manager tier policy governing a goal, or null. */
export function readTierPolicy(goalId) {
  if (!goalId) return null;
  return state[goalId] || null;
}

/** Seed the cache from the server, once per session. */
export async function hydrateTierPolicies() {
  if (hydrated || hydrating || typeof window === "undefined") return;
  hydrating = true;
  try {
    const res = await fetch("/api/v1/tier-policies/mine", {
      credentials: "include",
    });
    if (res.status === 401) return; // not authed yet — retry on a later mount
    // Only a SUCCESSFUL fetch counts as hydrated: marking hydrated before
    // the ok-check meant a transient 500 permanently pinned this session
    // to an empty policy map, silently grading every goal against the
    // AI's guessed tiers instead of the manager's criteria.
    if (!res.ok) return;
    hydrated = true;
    const body = await res.json().catch(() => ({}));
    const map = body?.policies && typeof body.policies === "object" ? body.policies : {};
    const next = {};
    for (const [goalId, p] of Object.entries(map)) {
      if (!p) continue;
      next[goalId] = {
        code: p.code ?? "",
        finalTiers: p.finalTiers ?? null,
        cadenceTiers: p.cadenceTiers ?? null,
      };
    }
    state = next;
    notify();
  } catch {
    /* offline — falls back to spec.tiers until a later hydrate */
  } finally {
    hydrating = false;
  }
}

export function resetTierPolicies() {
  state = {};
  hydrated = false;
  hydrating = false;
  notify();
}

if (typeof window !== "undefined") {
  window.addEventListener("auth:user-storage-cleared", resetTierPolicies);
}

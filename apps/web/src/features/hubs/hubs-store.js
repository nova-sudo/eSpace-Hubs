"use client";

/**
 * In-memory cache of the user's available hubs.
 *
 * The /api/v1/hubs/me response is the source of truth; the hook below
 * fetches once per authenticated session and caches the result. We
 * keep an external store (vs a stateful hook) so multiple components
 * mounting useAvailableHubs() don't each fire their own /me request.
 *
 * Shape mirrors the server response:
 *   { status: "loading" | "ready" | "error",
 *     hubs:          HubDefinition[],
 *     primaryHubId:  string | null,
 *     defaultHubId:  string | null,
 *     error:         {code, message} | null }
 */

const subscribers = new Set();

let state = {
  status: "loading",
  hubs: [],
  primaryHubId: null,
  defaultHubId: null,
  error: null,
};

export function getHubsState() {
  return state;
}

export function setHubsState(patch) {
  state = typeof patch === "function" ? patch(state) : { ...state, ...patch };
  for (const cb of subscribers) cb();
}

export function subscribeHubs(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

/**
 * Reset to the loading state. Called on logout so the next sign-in
 * triggers a fresh /hubs/me fetch — otherwise a different user signing
 * in on the same device would briefly see the prior user's hubs.
 */
export function resetHubsStore() {
  state = {
    status: "loading",
    hubs: [],
    primaryHubId: null,
    defaultHubId: null,
    error: null,
  };
  for (const cb of subscribers) cb();
}

"use client";

/**
 * Reactive store for the user's `/me/api-origin` lookup.
 *
 * Backend contract (see apps/api/src/modules/auth/controller.ts):
 *
 *   GET /api/v1/auth/me/api-origin →
 *     { origin: "https://<companion-hostname>",
 *       source: "companion",
 *       lastSeenAt: "<iso>" }                  // fresh tunnel
 *
 *     { origin: null,
 *       source: "bundled",
 *       lastSeenAt: "<iso>" | null,
 *       staleHostname: "<hostname>" | null }   // no tunnel OR stale
 *
 * Why a store and not just a useEffect-per-component
 * ──────────────────────────────────────────────────
 * The header chip and any "companion offline" banner both want to
 * react to the SAME state without duplicating fetches. The session
 * store pattern (module-level state + dispatch event) keeps this
 * cheap — one fetch per login, occasional refresh, and consumers
 * subscribe via React's useSyncExternalStore.
 *
 * Refresh cadence:
 *   - On session establishment (SessionProvider mount)
 *   - On every 60s while the user is on the site, to catch a
 *     just-started or just-stopped companion
 *   - Manual via `refreshApiOrigin()` after the user finishes the
 *     pairing flow
 */

const CHANGE_EVENT = "companion-api-origin:change";
const INITIAL = {
  /** "companion" | "bundled" | null (null = haven't fetched yet) */
  source: null,
  /** Companion hostname when source === "companion", null otherwise. */
  hostname: null,
  /** Last successful heartbeat ISO ts. May be stale OR null. */
  lastSeenAt: null,
  /** When the companion is stale, the server returns its last-known
   *  hostname so the UI can show "Companion <hostname> went offline"
   *  rather than a generic "no companion." */
  staleHostname: null,
  loading: false,
  error: null,
};

let state = INITIAL;
const listeners = new Set();

function emit() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHANGE_EVENT));
  for (const fn of listeners) fn();
}

export function getApiOrigin() {
  return state;
}

export function setApiOrigin(next) {
  state = { ...state, ...next };
  emit();
}

export function subscribeApiOrigin(cb) {
  if (typeof window === "undefined") return () => {};
  listeners.add(cb);
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  return () => {
    listeners.delete(cb);
    window.removeEventListener(CHANGE_EVENT, handler);
  };
}

"use client";

/**
 * localStorage-backed store for the user's "currently active hub
 * pick".
 *
 * Why pick state matters separately from the user's `primaryHub`:
 *   - primaryHub is the user's stored DEFAULT (the hub they land in
 *     unless they say otherwise; persisted server-side).
 *   - The "pick" is the CURRENT in-session choice. A bootstrap
 *     admin (roles: admin+dev+qa) might want to spend the next
 *     hour in QA without changing their server-side primary.
 *
 * Lifecycle:
 *   - Login → / → if >1 hubs available AND no recent pick → the
 *     picker UI renders. User clicks → pick is set.
 *   - On subsequent visits to /, if the pick is fresh (< 24h) and
 *     valid (in the user's allowed list), redirect to that hub
 *     without showing the picker again.
 *   - Header HubSwitcher overwrites the pick.
 *   - Logout → store is cleared (via resetHubsStore in the M10.2
 *     fetcher, plus this module's clear on session-flip).
 *
 * Pick is per-device — different browser profiles can prefer
 * different hubs for the same user. Same pattern as the integrations
 * store: localStorage is the source of truth for the UI, server is
 * authoritative for the identity behind it.
 */

const KEY = "espace-devhub:active-hub-pick";

/**
 * Pick freshness window. After 24h, the picker re-prompts even
 * if a stale pick exists. Tuned for "you start a fresh workday,
 * you reconsider where to land".
 */
const PICK_TTL_MS = 24 * 60 * 60 * 1000;

const subscribers = new Set();

function read() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.hubId !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getActivePick() {
  return read();
}

/**
 * Returns the picked hubId if there's a fresh, valid pick in the
 * allowed-hubs list. Returns null if no pick, expired, or not
 * accessible to this user any more (e.g. an admin revoked the role).
 */
export function getValidPick(allowedHubIds) {
  const pick = read();
  if (!pick) return null;
  if (typeof pick.pickedAt !== "number") return null;
  if (Date.now() - pick.pickedAt > PICK_TTL_MS) return null;
  if (Array.isArray(allowedHubIds) && !allowedHubIds.includes(pick.hubId)) {
    return null;
  }
  return pick.hubId;
}

export function setActivePick(hubId) {
  if (typeof window === "undefined") return;
  if (typeof hubId !== "string" || hubId.length === 0) return;
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ hubId, pickedAt: Date.now() }),
    );
  } catch {
    /* quota / private mode — swallow */
  }
  for (const cb of subscribers) cb();
}

export function clearActivePick() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* swallow */
  }
  for (const cb of subscribers) cb();
}

export function subscribeHubPick(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export const HUB_PICK_KEY = KEY;

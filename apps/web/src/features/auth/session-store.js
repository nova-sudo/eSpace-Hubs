"use client";

/**
 * Tiny in-memory session store. Mirrors the useSyncExternalStore
 * pattern used throughout the rest of the app (goals-store, snapshots-
 * store, etc.) so consumers can subscribe via React's built-in hook.
 *
 * The TRUE source of session truth is the server (via the cookie).
 * This module just caches the result of GET /api/v1/auth/me so the
 * dashboard doesn't refetch on every render.
 *
 * Shape:
 *   {
 *     user:    PublicUser | null,
 *     loading: boolean,                 // initial / refetch
 *     needsTotp: boolean,               // login succeeded password but
 *                                        // requires step-2 verification
 *     error:   {code, message} | null
 *   }
 */

const CHANGE_EVENT = "auth:change";
const INITIAL = {
  user: null,
  loading: true,
  needsTotp: false,
  error: null,
};

let state = INITIAL;
const listeners = new Set();

function emit() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHANGE_EVENT));
  for (const fn of listeners) fn();
}

export function getSession() {
  return state;
}

export function setSession(next) {
  state = { ...state, ...next };
  emit();
}

export function subscribeSession(cb) {
  if (typeof window === "undefined") return () => {};
  listeners.add(cb);
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  return () => {
    listeners.delete(cb);
    window.removeEventListener(CHANGE_EVENT, handler);
  };
}

export const AUTH_CHANGE_EVENT = CHANGE_EVENT;

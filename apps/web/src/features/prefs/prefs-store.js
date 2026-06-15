"use client";

/**
 * API-direct store for synced user preferences (C7).
 *
 * Scope: the two prefs that belong to the PERSON, not the device —
 *   - aiProvider     ("mistral" | "glm" | "openrouter")
 *   - lastReviewDate (ISO date driving the "Since review" preset)
 * Device-local state (last-seen marker, active hub pick) deliberately
 * stays in localStorage — syncing it would break per-device behaviour.
 *
 * Source of truth: the server. Prefs ride down on the session user
 * (`GET /auth/me` → `user.prefs`, already fetched by SessionProvider),
 * so this store BRIDGES off the session store instead of issuing its
 * own fetch. Writes go through `PATCH /auth/me { prefs }` (the existing
 * self-service profile endpoint), optimistic with rollback.
 *
 * Synchronous reads: `getPrefs()` returns module-level state so the
 * non-React callers that read the AI provider inside async loops
 * (grading, classify) keep working without awaiting a hook.
 *
 * Legacy migration: pre-C7 users have these values only in localStorage.
 * On first hydration for a user, any legacy value the server doesn't yet
 * have is migrated up via a one-shot PATCH, then the local key is
 * dropped. (Auth transitions also wipe the legacy keys via
 * clear-user-storage.js; we reset to defaults on that event.)
 */

import { apiPatch } from "@/lib/api-client";
import { getSession, subscribeSession } from "@/features/auth/session-store";

const DEFAULTS = Object.freeze({ aiProvider: "anthropic", lastReviewDate: "" });
const VALID_PROVIDERS = new Set(["anthropic", "mistral", "glm", "openrouter"]);

// Legacy localStorage keys (pre-C7). Read once for migrate-up, then
// dropped. Kept in sync with clear-user-storage.js's allowlist.
const LEGACY_AI_KEY = "espace-devhub:ai-provider";
const LEGACY_REVIEW_KEY = "espace-devhub:last-review-date";

export const PREFS_CHANGE_EVENT = "prefs:change";
// Preserved from the old last-review store so existing subscribers
// (account tab, date-range consumers) keep reacting unchanged.
export const LAST_REVIEW_CHANGE_EVENT = "last-review-date:change";

let state = { ...DEFAULTS };
let tick = 0;
/** Which user id we've already hydrated prefs for — guards against a
 *  session re-emit clobbering local/optimistic values back to server. */
let hydratedForUserId = null;

function isAuthError(error) {
  return (
    error?.code === "unauthenticated" || error?.code === "totp_required"
  );
}

function commit(next) {
  const prev = state;
  state = next;
  tick += 1;
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(PREFS_CHANGE_EVENT));
  } catch {
    /* ignore */
  }
  // Fire the legacy event ONLY when the review date actually changed,
  // so subscribers keyed on it don't churn on aiProvider-only updates.
  if (prev.lastReviewDate !== next.lastReviewDate) {
    try {
      window.dispatchEvent(new Event(LAST_REVIEW_CHANGE_EVENT));
    } catch {
      /* ignore */
    }
  }
}

/* ─────────────────────── reads ─────────────────────── */

export function getPrefs() {
  return state;
}

export function getPrefsTick() {
  return tick;
}

export function getPrefsServerSnapshot() {
  return 0;
}

export function subscribePrefs(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(PREFS_CHANGE_EVENT, handler);
  return () => window.removeEventListener(PREFS_CHANGE_EVENT, handler);
}

/* ─────────────────────── legacy localStorage ─────────────────────── */

function readLegacy() {
  if (typeof window === "undefined") return {};
  const out = {};
  try {
    const v = localStorage.getItem(LEGACY_AI_KEY);
    if (v && VALID_PROVIDERS.has(v)) out.aiProvider = v;
  } catch {
    /* ignore */
  }
  try {
    const v = localStorage.getItem(LEGACY_REVIEW_KEY);
    if (v) out.lastReviewDate = v;
  } catch {
    /* ignore */
  }
  return out;
}

function clearLegacy() {
  if (typeof window === "undefined") return;
  for (const key of [LEGACY_AI_KEY, LEGACY_REVIEW_KEY]) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

/* ─────────────────────── session bridge ─────────────────────── */

/**
 * Derive prefs from the current session user. Runs on every session
 * change but only HYDRATES once per user id (so a later refresh / a
 * post-write re-emit doesn't overwrite an optimistic local value).
 */
function syncFromSession() {
  if (typeof window === "undefined") return;
  const { user } = getSession();
  const uid = user?.id ?? null;
  if (!uid) return; // logged out — reset handled by the auth event
  if (uid === hydratedForUserId) return;
  hydratedForUserId = uid;

  const serverPrefs = user.prefs || {};
  const legacy = readLegacy();

  // Server value wins; else adopt a legacy localStorage value; else
  // default. `lastReviewDate === ""` is an INTENTIONAL clear (distinct
  // from null = never set), so only fall back when it's null/undefined.
  const aiProvider =
    (VALID_PROVIDERS.has(serverPrefs.aiProvider) && serverPrefs.aiProvider) ||
    legacy.aiProvider ||
    DEFAULTS.aiProvider;
  const lastReviewDate =
    serverPrefs.lastReviewDate != null
      ? serverPrefs.lastReviewDate
      : legacy.lastReviewDate || DEFAULTS.lastReviewDate;

  commit({ aiProvider, lastReviewDate });

  // One-time migrate-up: push legacy values the server doesn't have yet,
  // then drop the local keys so we never re-adopt a stale value.
  const migrate = {};
  if (serverPrefs.aiProvider == null && legacy.aiProvider) {
    migrate.aiProvider = legacy.aiProvider;
  }
  if (serverPrefs.lastReviewDate == null && legacy.lastReviewDate) {
    migrate.lastReviewDate = legacy.lastReviewDate;
  }
  if (Object.keys(migrate).length > 0) {
    void apiPatch("/auth/me", { prefs: migrate }).then((r) => {
      if (r.ok) clearLegacy();
    });
  } else {
    clearLegacy();
  }
}

function reset() {
  hydratedForUserId = null;
  commit({ ...DEFAULTS });
}

if (typeof window !== "undefined") {
  // Re-hydrate when a fresh user's /me lands; reset on logout/login wipe.
  subscribeSession(() => syncFromSession());
  window.addEventListener("auth:user-storage-cleared", reset);
  // Catch a session that already resolved before this module loaded.
  syncFromSession();
}

/* ─────────────────────── writes ─────────────────────── */

/**
 * Persist the AI provider choice. Optimistic + background PATCH; rolls
 * back on a non-auth failure. No-op for an unknown id or an unchanged
 * value.
 */
export async function setAiProviderPref(id) {
  if (!VALID_PROVIDERS.has(id) || state.aiProvider === id) return;
  const prev = state;
  commit({ ...state, aiProvider: id });
  const r = await apiPatch("/auth/me", { prefs: { aiProvider: id } });
  if (!r.ok && !isAuthError(r.error)) {
    commit(prev);
    // eslint-disable-next-line no-console
    console.warn("[prefs] aiProvider save failed:", r.error?.code);
  }
}

/**
 * Persist the last-review date (ISO string, or "" to clear). Optimistic
 * + background PATCH; rolls back on a non-auth failure.
 */
export async function setLastReviewDatePref(iso) {
  const value = iso || "";
  if (state.lastReviewDate === value) return;
  const prev = state;
  commit({ ...state, lastReviewDate: value });
  const r = await apiPatch("/auth/me", { prefs: { lastReviewDate: value } });
  if (!r.ok && !isAuthError(r.error)) {
    commit(prev);
    // eslint-disable-next-line no-console
    console.warn("[prefs] lastReviewDate save failed:", r.error?.code);
  }
}

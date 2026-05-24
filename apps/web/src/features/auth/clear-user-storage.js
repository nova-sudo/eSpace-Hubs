"use client";

/**
 * Wipe every user-scoped localStorage key in one call.
 *
 * Why this exists
 * ───────────────
 * The pre-M7 design mirrored user data to localStorage so the dashboard
 * stayed responsive on slow networks. That design predates the multi-
 * user reality of the deployed app — and `logout()` never cleared the
 * mirror. The consequence was a real cross-user leak: a fresh signup
 * on the same browser hydrated from the prior user's localStorage
 * BEFORE the new user's `*Sync` components pulled their own data,
 * AND `MigrateOnce` then UPLOADED the prior user's data under the new
 * user's account (apps/web/src/features/migrate/migrate-once.jsx).
 *
 * Fix: clear all user-scoped keys synchronously at every auth-state
 * transition (login, logout, signup, accept-invite, TOTP verify). The
 * keys are listed here as an explicit allowlist rather than a
 * `localStorage:*` prefix sweep so anyone adding a new store
 * deliberately considers whether the value is user-scoped.
 *
 * NEVER add anything to this list that isn't user-scoped (themes,
 * dismissed banners, etc.) — those are intentionally preserved across
 * users on the same machine.
 *
 * Cross-tab note: `localStorage.removeItem` fires the `storage` event
 * in OTHER tabs but not the one calling it. The stores that subscribe
 * via the custom-event pattern (e.g. goals-store) won't auto-re-render
 * in the same tab — but that's fine here because the call sites flip
 * `user` immediately afterwards, which triggers the *Sync remount path
 * that does its own re-render.
 */

/**
 * Allowlist of user-scoped localStorage keys to clear on auth
 * transitions. Mirrors the inventory in apps/web/src/features/*.
 * When adding a new store with user-scoped data, ADD ITS KEY HERE.
 */
const USER_SCOPED_KEYS = Object.freeze([
  // goals moved to API-direct (no localStorage) — see goals-store.js.
  // Subscribers reset their in-memory state via the
  // "auth:user-storage-cleared" event we still dispatch below.
  "espace-devhub:snapshots",
  "espace-devhub:evidence",
  "espace-devhub:grading",
  "espace-devhub:goal-specs",
  "espace-devhub:goal-context",
  "espace-devhub:goal-inputs",
  "espace-devhub:integrations",
  "espace-devhub:ai-provider",
  "espace-devhub:chat",
  "espace-devhub:last-seen",
  "espace-devhub:last-review-date",
  "espace-devhub:active-hub-pick",
  "espace-devhub:migrate-completed-by-user",
  "eshub:qa:config:v1",
]);

/**
 * Synchronous wipe. Idempotent. SSR-safe (no-op when window is
 * undefined). Catches per-key errors so a single locked / corrupt
 * value can't block the rest of the wipe.
 */
export function clearAllUserScopedStorage() {
  if (typeof window === "undefined") return;
  for (const key of USER_SCOPED_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch (err) {
      // localStorage can throw on quota / private mode / disabled
      // storage. Log + continue so a misbehaving key doesn't trap us.
      // eslint-disable-next-line no-console
      console.warn(
        `[auth] failed to clear ${key}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  // Broadcast for any subscriber that wants to react (e.g. tests).
  // Same-tab listeners on `storage` don't fire from setItem/removeItem
  // calls in this tab — use the custom event for in-tab awareness.
  try {
    window.dispatchEvent(new Event("auth:user-storage-cleared"));
  } catch {
    /* ignore */
  }
}

/** Exported for tests + the danger-tab "reset everything" button so
 *  there's a single source of truth for what counts as user-scoped. */
export const USER_SCOPED_LOCAL_STORAGE_KEYS = USER_SCOPED_KEYS;

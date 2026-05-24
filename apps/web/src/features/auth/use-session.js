"use client";

import { useSyncExternalStore, useCallback } from "react";
import { apiGet, apiPost } from "@/lib/api-client";
import {
  getSession,
  setSession,
  subscribeSession,
} from "./session-store.js";
import { clearAllUserScopedStorage } from "./clear-user-storage.js";

// React's useSyncExternalStore compares snapshot return values by
// reference (Object.is). If getServerSnapshot allocates a new object on
// every call, React thinks the store changed every render and warns
// "The result of getServerSnapshot should be cached to avoid an
// infinite loop." Freezing the snapshot once at module scope and
// returning the same reference each call silences that and lets the
// SSR/hydration phase settle deterministically.
const SERVER_SNAPSHOT = Object.freeze({
  user: null,
  loading: true,
  needsTotp: false,
  error: null,
});

function serverSnapshot() {
  // SSR returns the "loading" state — the client will hydrate after
  // the first /me round-trip.
  return SERVER_SNAPSHOT;
}

/**
 * Single source of session-state truth for the frontend.
 *
 * Returns:
 *   user       PublicUser | null — current authenticated user
 *   loading    boolean           — initial fetch / refresh in flight
 *   needsTotp  boolean           — login succeeded password step but
 *                                   the user has TOTP enrolled and the
 *                                   session cookie carries totpVerified:false
 *   error      {code,message} | null
 *
 *   login({email, password})     — step 1 of two-step login
 *   verifyTotp({code})            — step 2 (only when needsTotp)
 *   logout()                      — destroys server session + clears state
 *   refresh()                     — refetch /me (used on app mount, after
 *                                   integrations changes, etc.)
 */
export function useSession() {
  const state = useSyncExternalStore(
    subscribeSession,
    getSession,
    serverSnapshot,
  );

  const refresh = useCallback(async () => {
    setSession({ loading: true, error: null });
    const result = await apiGet("/auth/me");
    if (result.ok) {
      setSession({
        user: result.data?.user ?? null,
        loading: false,
        needsTotp: false,
        error: null,
      });
      return;
    }
    // 401 totp_required means there IS a partial session — surface
    // that distinctly so the UI shows the TOTP step.
    if (result.error.code === "totp_required") {
      setSession({
        user: null,
        loading: false,
        needsTotp: true,
        error: null,
      });
      return;
    }
    // 401 unauthenticated → not logged in, but that's a normal state,
    // not an error to display.
    if (result.error.code === "unauthenticated") {
      setSession({
        user: null,
        loading: false,
        needsTotp: false,
        error: null,
      });
      return;
    }
    setSession({
      user: null,
      loading: false,
      needsTotp: false,
      error: result.error,
    });
  }, []);

  const login = useCallback(async ({ email, password }) => {
    setSession({ loading: true, error: null });
    const result = await apiPost("/auth/login", { email, password });
    if (!result.ok) {
      setSession({
        user: null,
        loading: false,
        needsTotp: false,
        error: result.error,
      });
      return { ok: false, error: result.error };
    }
    const { user, needsTotp } = result.data;
    // Cross-user data leak fix: wipe prior user's localStorage BEFORE
    // promoting the new user into the session store. The *Sync
    // components react to `user.id` change and will pull the new
    // user's real data from the API; wiping first ensures they don't
    // race against (or upload via MigrateOnce) the prior user's data.
    clearAllUserScopedStorage();
    setSession({
      user: needsTotp ? null : user,
      loading: false,
      needsTotp,
      error: null,
    });
    return { ok: true, needsTotp };
  }, []);

  const verifyTotp = useCallback(async ({ code }) => {
    setSession({ loading: true, error: null });
    const result = await apiPost("/auth/totp/verify", { code });
    if (!result.ok) {
      setSession((prev) => prev); // no-op; re-emit
      setSession({
        loading: false,
        // Keep needsTotp:true so the UI stays on the TOTP step.
        error: result.error,
      });
      return { ok: false, error: result.error };
    }
    // Same reasoning as in login() — wipe before promoting the user.
    // This branch matters for the two-step-login path: step 1 sets
    // `needsTotp:true` and leaves user=null, then step 2 here flips
    // user to the real user. The flip is the dangerous transition.
    clearAllUserScopedStorage();
    setSession({
      user: result.data?.user ?? null,
      loading: false,
      needsTotp: false,
      error: null,
    });
    return { ok: true };
  }, []);

  const logout = useCallback(async () => {
    const result = await apiPost("/auth/logout");
    // Wipe localStorage so the next user on this browser doesn't
    // inherit anything from the session that just ended. Order
    // doesn't matter here — there's no new user about to mount, just
    // the bare /login screen.
    clearAllUserScopedStorage();
    setSession({
      user: null,
      loading: false,
      needsTotp: false,
      error: null,
    });
    return result;
  }, []);

  return {
    ...state,
    refresh,
    login,
    verifyTotp,
    logout,
  };
}

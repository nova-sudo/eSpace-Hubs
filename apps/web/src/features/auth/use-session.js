"use client";

import { useSyncExternalStore, useCallback } from "react";
import { mutate as mutateSwr } from "swr";
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

/**
 * Drop every SWR cache entry without refetching. SWR keys in this app
 * are mostly NOT user-scoped ("my-manager-notes", "/notifications", …),
 * so a second user signing in on the same tab without a reload would
 * briefly see the first user's cached data. Called on logout and
 * whenever the signed-in user id changes.
 */
function clearSwrCache() {
  try {
    mutateSwr(() => true, undefined, { revalidate: false });
  } catch {
    // SWR not initialised yet — nothing cached to clear.
  }
}

/** Promote `user` into the session, clearing SWR when the id changes. */
function setSessionUser(patch) {
  const prevId = getSession().user?.id ?? null;
  const nextId = patch.user?.id ?? null;
  // Only a real hand-over (A → B, or A → signed out) can leak; the
  // first null → A on page load has nothing cached worth dropping.
  if (prevId !== null && prevId !== nextId) {
    clearSwrCache();
  }
  setSession(patch);
}

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
 *   refreshSilent()               — same, without flipping `loading` (use
 *                                   after an in-page save so AuthGuard
 *                                   doesn't blank the page)
 */
export function useSession() {
  const state = useSyncExternalStore(
    subscribeSession,
    getSession,
    serverSnapshot,
  );

  // `silent` keeps `loading` untouched so AuthGuard doesn't swap a
  // mounted page for the "Authenticating…" placeholder while a
  // post-save refetch of /me is in flight (Account tab save, TOTP
  // enrolment, onboarding submit, approval polling). The loud variant
  // is for the initial mount / auth transitions where a placeholder is
  // the right thing to show.
  const runRefresh = useCallback(async ({ silent = false } = {}) => {
    setSession(silent ? { error: null } : { loading: true, error: null });
    const result = await apiGet("/auth/me");
    if (result.ok) {
      setSessionUser({
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
      setSessionUser({
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
      setSessionUser({
        user: null,
        loading: false,
        needsTotp: false,
        error: null,
      });
      return;
    }
    setSessionUser({
      user: null,
      loading: false,
      needsTotp: false,
      error: result.error,
    });
  }, []);

  const refresh = useCallback(() => runRefresh(), [runRefresh]);
  const refreshSilent = useCallback(
    () => runRefresh({ silent: true }),
    [runRefresh],
  );

  const login = useCallback(async ({ email, password }) => {
    setSession({ loading: true, error: null });
    const result = await apiPost("/auth/login", { email, password });
    if (!result.ok) {
      setSessionUser({
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
    clearSwrCache();
    setSessionUser({
      user: needsTotp ? null : user,
      loading: false,
      needsTotp,
      error: null,
    });
    return { ok: true, needsTotp };
  }, []);

  // Step 2 of login: either a 6-digit authenticator `code` or a
  // single-use `backupCode`. The server answers with how many backup
  // codes are left so the form can warn when they run low.
  const verifyTotp = useCallback(async ({ code, backupCode }) => {
    setSession({ loading: true, error: null });
    const result = await apiPost(
      "/auth/totp/verify",
      backupCode ? { backupCode } : { code },
    );
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
    clearSwrCache();
    setSessionUser({
      user: result.data?.user ?? null,
      loading: false,
      needsTotp: false,
      error: null,
    });
    return {
      ok: true,
      user: result.data?.user ?? null,
      usedBackupCode: !!result.data?.usedBackupCode,
      backupCodesRemaining: result.data?.backupCodesRemaining ?? null,
    };
  }, []);

  const logout = useCallback(async () => {
    const result = await apiPost("/auth/logout");
    // Wipe localStorage so the next user on this browser doesn't
    // inherit anything from the session that just ended. Order
    // doesn't matter here — there's no new user about to mount, just
    // the bare /login screen.
    clearAllUserScopedStorage();
    clearSwrCache();
    setSessionUser({
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
    refreshSilent,
    login,
    verifyTotp,
    logout,
  };
}

"use client";

import { useSyncExternalStore, useCallback } from "react";
import { apiGet, apiPost } from "@/lib/api-client";
import {
  getSession,
  setSession,
  subscribeSession,
} from "./session-store.js";

function serverSnapshot() {
  // SSR returns the "loading" state — the client will hydrate after
  // the first /me round-trip.
  return { user: null, loading: true, needsTotp: false, error: null };
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

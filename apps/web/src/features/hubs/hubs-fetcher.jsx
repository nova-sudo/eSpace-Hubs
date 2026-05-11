"use client";

/**
 * Lifecycle component for the hubs store.
 *
 * Same pattern as the per-store <*Sync /> components: mounted in the
 * root layout, reads useSession(), and on session-authenticated fires
 * one GET /api/v1/hubs/me. Renders null.
 *
 * Why a single fetcher instead of "useAvailableHubs auto-fetches":
 *   - Multiple useAvailableHubs() consumers would otherwise each fire
 *     the request on mount. Centralising the fetch on a single
 *     lifecycle node guarantees one round-trip per session.
 *   - Clear de-init: when the session ends (logout) we reset the
 *     store so a different user signing in on the same device doesn't
 *     briefly see the prior user's hubs.
 */

import { useEffect, useRef } from "react";
import { apiGet } from "@/lib/api-client";
import { useSession } from "@/features/auth";
import { resetHubsStore, setHubsState, getHubsState } from "./hubs-store";

const LOG_PREFIX = "[hubs-fetcher]";

export function HubsFetcher() {
  const { user, loading } = useSession();
  // Track who we last fetched for so a sign-out/sign-in cycle (or
  // an admin impersonating a different user) refetches.
  const lastUserIdRef = useRef(null);

  useEffect(() => {
    if (loading) return;

    if (!user) {
      if (lastUserIdRef.current !== null) {
        // Session just dropped — wipe the cache so the next sign-in
        // doesn't see stale data for ~1 paint.
        resetHubsStore();
        lastUserIdRef.current = null;
      }
      return;
    }

    if (lastUserIdRef.current === user.id) {
      // Already fetched for this user. Future invalidation hooks
      // (admin grants/revokes a hub) will call resetHubsStore()
      // explicitly.
      return;
    }

    let cancelled = false;
    setHubsState({ status: "loading", error: null });
    lastUserIdRef.current = user.id;

    (async () => {
      const r = await apiGet("/hubs/me");
      if (cancelled) return;
      if (!r.ok) {
        // eslint-disable-next-line no-console
        console.warn(
          `${LOG_PREFIX} fetch failed:`,
          r.error?.code,
          r.error?.message,
        );
        setHubsState({
          status: "error",
          hubs: [],
          primaryHubId: null,
          defaultHubId: null,
          error: r.error,
        });
        // Allow a retry on next session change.
        lastUserIdRef.current = null;
        return;
      }
      const data = r.data ?? {};
      setHubsState({
        status: "ready",
        hubs: Array.isArray(data.hubs) ? data.hubs : [],
        primaryHubId:
          typeof data.primaryHubId === "string" ? data.primaryHubId : null,
        defaultHubId:
          typeof data.defaultHubId === "string" ? data.defaultHubId : null,
        error: null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  // Suppress unused-var warning when getHubsState is only consumed
  // indirectly via the store subscribers — keep the import live so the
  // module evaluation triggers store initialisation in lazy-load setups.
  void getHubsState;
  return null;
}

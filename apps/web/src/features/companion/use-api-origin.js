"use client";

/**
 * Reactive hook over the api-origin store. Mirrors useSession's
 * shape: returns the current state + a `refresh()` you can call after
 * the companion app reports a change.
 *
 * The auto-refresh ticker lives in `CompanionApiOriginProvider`, NOT
 * here — multiple components calling this hook shouldn't multiply
 * the fetch rate.
 */

import { useCallback, useSyncExternalStore } from "react";
import { apiGet } from "@/lib/api-client";
import {
  getApiOrigin,
  setApiOrigin,
  subscribeApiOrigin,
} from "./api-origin-store.js";

const SERVER_SNAPSHOT = Object.freeze({
  source: null,
  hostname: null,
  lastSeenAt: null,
  staleHostname: null,
  loading: false,
  error: null,
});

function serverSnapshot() {
  return SERVER_SNAPSHOT;
}

export async function refreshApiOrigin() {
  setApiOrigin({ loading: true, error: null });
  const result = await apiGet("/auth/me/api-origin");
  if (!result.ok) {
    // 401 unauthenticated is normal (logged-out users) — just clear
    // state without surfacing an error.
    if (result.error.code === "unauthenticated") {
      setApiOrigin({
        source: null,
        hostname: null,
        lastSeenAt: null,
        staleHostname: null,
        loading: false,
        error: null,
      });
      return;
    }
    setApiOrigin({ loading: false, error: result.error });
    return;
  }
  const d = result.data || {};
  setApiOrigin({
    source: d.source ?? "bundled",
    hostname:
      d.source === "companion" && typeof d.origin === "string"
        ? d.origin.replace(/^https?:\/\//, "")
        : null,
    lastSeenAt: d.lastSeenAt ?? null,
    staleHostname: d.staleHostname ?? null,
    loading: false,
    error: null,
  });
}

export function useApiOrigin() {
  const state = useSyncExternalStore(
    subscribeApiOrigin,
    getApiOrigin,
    serverSnapshot,
  );
  const refresh = useCallback(() => refreshApiOrigin(), []);
  return { ...state, refresh };
}

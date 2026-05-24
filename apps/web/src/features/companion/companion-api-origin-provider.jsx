"use client";

/**
 * Mounts once at the root layout (alongside SessionProvider). Drives
 * the api-origin store:
 *
 *   1. Fetches /me/api-origin on session establishment.
 *   2. Re-fetches every 60s while the tab is in foreground so the
 *      header chip flips from "companion" → "bundled" within a
 *      heartbeat window of the companion going offline.
 *   3. Bumps an immediate refresh on tab focus (catches the case
 *      where the user paused the companion in another window).
 *
 * No children render gating — this is a side-effect-only component.
 */

import { useEffect } from "react";
import { useSession } from "@/features/auth";
import { refreshApiOrigin } from "./use-api-origin.js";

const REFRESH_INTERVAL_MS = 60_000;

export function CompanionApiOriginProvider({ children }) {
  const { user } = useSession();

  useEffect(() => {
    if (!user) return;
    // Initial fetch right after the session lands.
    void refreshApiOrigin();
    const t = setInterval(() => {
      // Skip the tick if the tab is backgrounded — there's no UI to
      // update, and we'd rather pay the round-trip when the user
      // returns focus.
      if (typeof document !== "undefined" && document.hidden) return;
      void refreshApiOrigin();
    }, REFRESH_INTERVAL_MS);
    const onFocus = () => {
      void refreshApiOrigin();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("focus", onFocus);
    }
    return () => {
      clearInterval(t);
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
      }
    };
  }, [user]);

  return children;
}

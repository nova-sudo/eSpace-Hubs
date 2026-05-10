"use client";

/**
 * Mounts once at the root layout. Triggers the initial `/auth/me`
 * lookup so every consumer of useSession() reads from a populated
 * store on first render.
 *
 * No React context — the session store is module-level so children
 * import `useSession` directly. The provider is just the lifecycle
 * hook that kicks off the first fetch.
 */

import { useEffect } from "react";
import { useSession } from "./use-session.js";

export function SessionProvider({ children }) {
  const { refresh } = useSession();
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return children;
}

"use client";

/**
 * Mounts once at the root layout. Two jobs:
 *
 *   1. Trigger the initial `/auth/me` lookup so every consumer of
 *      useSession() reads from a populated store on first render.
 *
 *   2. Cross-user data-leak backstop: detect when the resolved user
 *      ID changes from one value to a DIFFERENT non-null value and
 *      wipe localStorage. The primary fix is in the explicit auth
 *      mutation paths (login / verifyTotp / signup / accept-invite /
 *      logout) — see clear-user-storage.js. This effect is a belt-
 *      and-suspenders backstop catching transitions that bypass those
 *      paths (e.g. a future SSO callback that flips `user` via
 *      `setSession` directly).
 *
 *      The race vs. *Sync components: this effect fires AFTER the
 *      user-state change, so Sync effects depending on `user.id`
 *      might already have started. That's why we wipe in the
 *      mutation paths FIRST (synchronously, before setSession). This
 *      is just defense-in-depth.
 *
 * No React context — the session store is module-level so children
 * import `useSession` directly. The provider is just the lifecycle
 * hook that kicks off the first fetch.
 */

import { useEffect, useRef } from "react";
import { useSession } from "./use-session.js";
import { clearAllUserScopedStorage } from "./clear-user-storage.js";

export function SessionProvider({ children }) {
  const { refresh, user } = useSession();
  const lastUserIdRef = useRef(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const currentId = user?.id ?? null;
    const lastId = lastUserIdRef.current;
    // Only act on a transition between two different non-null ids.
    // null → user (fresh sign-in on a clean browser) and user → null
    // (logout) are handled by the explicit auth-mutation wipes; we
    // don't want to double-wipe here.
    if (lastId && currentId && lastId !== currentId) {
      clearAllUserScopedStorage();
    }
    lastUserIdRef.current = currentId;
  }, [user?.id]);

  return children;
}

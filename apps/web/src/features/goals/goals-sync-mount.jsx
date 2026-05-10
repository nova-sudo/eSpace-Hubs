"use client";

/**
 * <GoalsSync /> — pulls /goals once on session establishment.
 * Uses _replaceLocalNoMirror so the resulting localStorage write
 * doesn't fire another PUT back to the server (which would
 * round-trip the same tree).
 *
 * If the server has no goals yet (empty l1s), the merge is a no-op
 * — local-only goals from before login stay.
 */

import { useEffect, useRef } from "react";
import { useSession } from "@/features/auth";
import { _replaceLocalNoMirror } from "./goals-store";
import { pullGoalsFromApi } from "./goals-sync";

export function GoalsSync() {
  const { user, loading } = useSession();
  const lastSyncedUserId = useRef(null);

  useEffect(() => {
    if (loading || !user) return;
    if (lastSyncedUserId.current === user.id) return;
    lastSyncedUserId.current = user.id;
    void pullGoalsFromApi(_replaceLocalNoMirror).then((count) => {
      if (count > 0) {
        // eslint-disable-next-line no-console
        console.info(`[goals-sync] loaded ${count} L1s from API`);
      }
    });
  }, [user, loading]);

  return null;
}

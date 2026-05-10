"use client";

/**
 * <ContextSync /> — pulls /goal-context once on session establishment
 * and merges into localStorage via saveContextFor. Same idempotency
 * guard pattern as GradingSync / SnapshotsSync.
 */

import { useEffect, useRef } from "react";
import { useSession } from "@/features/auth";
import { saveContextFor } from "./context-store";
import { pullContextFromApi } from "./context-sync";

export function ContextSync() {
  const { user, loading } = useSession();
  const lastSyncedUserId = useRef(null);

  useEffect(() => {
    if (loading || !user) return;
    if (lastSyncedUserId.current === user.id) return;
    lastSyncedUserId.current = user.id;
    void pullContextFromApi(saveContextFor).then((count) => {
      if (count > 0) {
        // eslint-disable-next-line no-console
        console.info(
          `[goal-context-sync] merged ${count} per-goal answers from API`,
        );
      }
    });
  }, [user, loading]);

  return null;
}

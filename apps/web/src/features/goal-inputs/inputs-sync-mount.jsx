"use client";

/**
 * <InputsSync /> — pulls /goal-inputs once on session establishment
 * and merges into localStorage via mergeRemoteEntries.
 */

import { useEffect, useRef } from "react";
import { useSession } from "@/features/auth";
import { mergeRemoteEntries } from "./inputs-store";
import { pullInputsFromApi } from "./inputs-sync";

export function InputsSync() {
  const { user, loading } = useSession();
  const lastSyncedUserId = useRef(null);

  useEffect(() => {
    if (loading || !user) return;
    if (lastSyncedUserId.current === user.id) return;
    lastSyncedUserId.current = user.id;
    void pullInputsFromApi(mergeRemoteEntries).then((count) => {
      if (count > 0) {
        // eslint-disable-next-line no-console
        console.info(`[goal-inputs-sync] merged ${count} entries from API`);
      }
    });
  }, [user, loading]);

  return null;
}

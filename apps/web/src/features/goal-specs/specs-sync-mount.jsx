"use client";

/**
 * <SpecsSync /> — pulls /goal-specs once on session establishment and
 * merges into localStorage via saveSpec (which re-validates each
 * incoming spec). Updates lastAnalyzedAt to track the server's view.
 */

import { useEffect, useRef } from "react";
import { useSession } from "@/features/auth";
import { markAnalyzedAt, saveSpec } from "./specs-store";
import { pullSpecsFromApi } from "./specs-sync";

export function SpecsSync() {
  const { user, loading } = useSession();
  const lastSyncedUserId = useRef(null);

  useEffect(() => {
    if (loading || !user) return;
    if (lastSyncedUserId.current === user.id) return;
    lastSyncedUserId.current = user.id;
    void pullSpecsFromApi(saveSpec, markAnalyzedAt).then((count) => {
      if (count > 0) {
        // eslint-disable-next-line no-console
        console.info(`[goal-specs-sync] merged ${count} specs from API`);
      }
    });
  }, [user, loading]);

  return null;
}

"use client";

/**
 * Lifecycle component — mounts once at the root layout. When the
 * session settles into "authenticated" state, pulls the grading
 * verdicts from the API and merges them into localStorage.
 *
 * Why on session establishment, not on every render:
 *   - The grading cache only matters AFTER a user is signed in
 *     (anonymous users have no server-side row to pull). Pulling
 *     repeatedly would waste a request per page load.
 *   - The pull is additive — local entries are preserved. A user
 *     who graded PRs before logging in keeps those verdicts when
 *     they sign in.
 *
 * Implementation: triggers a one-shot pull when user.id changes from
 * null → some id. The ref makes the effect idempotent across
 * re-renders.
 */

import { useEffect, useRef } from "react";
import { useSession } from "@/features/auth";
import { saveVerdict } from "./grading-store";
import { pullVerdictsFromApi } from "./grading-sync";

export function GradingSync() {
  const { user, loading } = useSession();
  const lastSyncedUserId = useRef(null);

  useEffect(() => {
    if (loading || !user) return;
    if (lastSyncedUserId.current === user.id) return;
    lastSyncedUserId.current = user.id;
    void pullVerdictsFromApi(saveVerdict).then((count) => {
      if (count > 0) {
        // eslint-disable-next-line no-console
        console.info(`[grading-sync] merged ${count} verdicts from API`);
      }
    });
  }, [user, loading]);

  return null;
}

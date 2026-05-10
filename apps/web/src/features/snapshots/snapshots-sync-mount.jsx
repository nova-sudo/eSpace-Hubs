"use client";

/**
 * <SnapshotsSync /> — mounts once at the root layout (inside
 * SessionProvider). Pulls /api/v1/snapshots on session establishment
 * and merges into localStorage via the local saveSnapshot, which
 * applies normaliseSnapshot + the manual-wins rule for each row.
 *
 * Same idempotency guard as <GradingSync /> — a ref tracks the last
 * synced user.id so re-renders don't re-fire.
 *
 * The local store caps at 60 snapshots. Pulling 250 from the API into
 * a full local buffer is safe because saveSnapshot sorts by week
 * descending and slices to 60 — older API rows that wouldn't fit get
 * silently dropped.
 */

import { useEffect, useRef } from "react";
import { useSession } from "@/features/auth";
import { saveSnapshot } from "./snapshots-store";
import { pullSnapshotsFromApi } from "./snapshots-sync";

export function SnapshotsSync() {
  const { user, loading } = useSession();
  const lastSyncedUserId = useRef(null);

  useEffect(() => {
    if (loading || !user) return;
    if (lastSyncedUserId.current === user.id) return;
    lastSyncedUserId.current = user.id;
    void pullSnapshotsFromApi(saveSnapshot).then((count) => {
      if (count > 0) {
        // eslint-disable-next-line no-console
        console.info(`[snapshots-sync] merged ${count} snapshots from API`);
      }
    });
  }, [user, loading]);

  return null;
}

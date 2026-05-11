"use client";

/**
 * <SnapshotsSync /> — mounts once at the root layout (inside
 * SessionProvider). Pulls /api/v1/snapshots on session establishment
 * and merges into localStorage via `applyPulledSnapshot` — the
 * no-mirror path.
 *
 * Pre-hotfix this used `saveSnapshot`, which mirrors every write
 * back via POST /snapshots. With ~17 server-side snapshots that
 * meant 17 mirror writes on every session pull — observed as a
 * tight POST /snapshots loop in the API log AND likely starving
 * the SWR fetchers for /integrations/proxy/* (continuous renders
 * from each writeAll's dispatchEvent kept the dashboard churning).
 *
 * Same idempotency guard as <GradingSync /> — a ref tracks the last
 * synced user.id so re-renders don't re-fire.
 *
 * The local store caps at 60 snapshots. Pulling 250 from the API
 * into a full local buffer is safe because applyPulledSnapshot
 * sorts by week descending and slices to 60 — older API rows that
 * wouldn't fit get silently dropped.
 */

import { useEffect, useRef } from "react";
import { useSession } from "@/features/auth";
import { applyPulledSnapshot } from "./snapshots-store";
import { pullSnapshotsFromApi } from "./snapshots-sync";

export function SnapshotsSync() {
  const { user, loading } = useSession();
  const lastSyncedUserId = useRef(null);

  useEffect(() => {
    if (loading || !user) return;
    if (lastSyncedUserId.current === user.id) return;
    lastSyncedUserId.current = user.id;
    void pullSnapshotsFromApi(applyPulledSnapshot).then((count) => {
      if (count > 0) {
        // eslint-disable-next-line no-console
        console.info(`[snapshots-sync] merged ${count} snapshots from API`);
      }
    });
  }, [user, loading]);

  return null;
}

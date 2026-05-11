"use client";

/**
 * One-shot localStorage→API migration trigger.
 *
 * Mounted alongside the per-store <*Sync /> components in the root
 * layout. The component renders nothing — it's a lifecycle effect.
 *
 * Flow:
 *   1. Wait until useSession() reports an authenticated user.
 *   2. If the local migration marker is already set, exit. The
 *      device has already uploaded; the per-store mirror writes
 *      keep things in sync from here on.
 *   3. Read the seven legacy localStorage keys via
 *      collectMigrationPayload(). If nothing to send, set the
 *      marker anyway and exit — a fresh device shouldn't keep
 *      retrying the no-op call every session.
 *   4. POST to /api/v1/migrate/import. On success, write the
 *      marker with the server-returned counts. On failure, log
 *      and bail (next session retries).
 *
 * Concurrency with the <*Sync /> pulls:
 *   The pull helpers only replaceLocal() when the server returns
 *   non-empty content. On a fresh user the pulls are no-ops, so
 *   they can't clobber the local data we're about to upload.
 *   We don't await the pulls — both run in parallel and converge.
 *
 * Toast:
 *   Uses sonner (already mounted at the root). A one-off "Synced
 *   N items to your account" with the per-collection counts. Quiet
 *   on no-data devices.
 */

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useSession } from "@/features/auth";
import { apiPost } from "@/lib/api-client";
import { collectMigrationPayload } from "./collect-payload";
import { readMigrationMarker, writeMigrationMarker } from "./migrate-store";

const LOG_PREFIX = "[migrate-once]";

function totalImported(counts) {
  if (!counts || typeof counts !== "object") return 0;
  let n = 0;
  for (const value of Object.values(counts)) {
    if (typeof value === "number") {
      n += value;
    } else if (value && typeof value === "object" && "imported" in value) {
      n += Number(value.imported) || 0;
    }
  }
  return n;
}

export function MigrateOnce() {
  const { user, loading } = useSession();
  // Guards against React 18 StrictMode double-mounting in dev — we
  // only want one POST per page lifetime.
  const firedRef = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!user) return;
    if (firedRef.current) return;

    // Already migrated on this device — nothing to do.
    if (readMigrationMarker()) {
      firedRef.current = true;
      return;
    }

    const { payload, hasAny } = collectMigrationPayload();

    // No legacy data on this device. Set the marker so we don't
    // keep checking on every future session.
    if (!hasAny) {
      writeMigrationMarker(null);
      firedRef.current = true;
      return;
    }

    firedRef.current = true;

    (async () => {
      const result = await apiPost("/migrate/import", payload);
      if (!result.ok) {
        // Auth failures: just leave the marker unset — next session
        // will retry once the cookie is good.
        // eslint-disable-next-line no-console
        console.warn(
          `${LOG_PREFIX} import failed:`,
          result.error?.code,
          result.error?.message,
        );
        firedRef.current = false;
        return;
      }

      const counts = result.data?.counts ?? null;
      writeMigrationMarker(counts);

      const total = totalImported(counts);
      if (total > 0) {
        toast.success(`Synced ${total} item${total === 1 ? "" : "s"} to your account.`, {
          description: "Your local dashboard is now backed up to the server.",
        });
      }
    })();
  }, [user, loading]);

  return null;
}

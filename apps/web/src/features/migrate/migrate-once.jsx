"use client";

/**
 * One-shot localStorage→API migration trigger, per-(device, user).
 *
 * Mounted alongside the per-store <*Sync /> components in the root
 * layout. Renders nothing — it's a lifecycle effect.
 *
 * Flow:
 *   1. Wait until useSession() reports an authenticated user.
 *   2. If the local migration marker is set FOR THIS USER, exit.
 *      (Pre-hotfix the marker was per-device. A different user
 *      signing in on the same browser would skip the migration and
 *      land without their localStorage data on the server — which
 *      broke the integrations proxy because no encrypted token was
 *      stored under their userId.)
 *   3. Read the seven legacy localStorage keys via
 *      collectMigrationPayload(). If nothing to send, set the marker
 *      anyway and exit.
 *   4. POST to /api/v1/migrate/import. On success, write the marker
 *      under the user's id with the server-returned counts. On
 *      failure, log + bail; next session retries.
 *
 * Re-fires per user change: if the user logs out and a different
 * user logs in on the same browser, firedRef resets via the user.id
 * key in the effect — the new user gets their own migration check.
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
  // Per-user fired flag — re-fires when the user.id changes (logout
  // + login as a different user on the same browser tab).
  const firedForUserRef = useRef(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      firedForUserRef.current = null;
      return;
    }
    if (firedForUserRef.current === user.id) return;

    // Already migrated this user on this device — nothing to do.
    if (readMigrationMarker(user.id)) {
      firedForUserRef.current = user.id;
      return;
    }

    const { payload, hasAny } = collectMigrationPayload();

    // No legacy data on this device. Set the marker for this user
    // so we don't keep checking on every future session.
    if (!hasAny) {
      writeMigrationMarker(user.id, null);
      firedForUserRef.current = user.id;
      return;
    }

    firedForUserRef.current = user.id;
    const userIdAtStart = user.id;

    (async () => {
      const result = await apiPost("/migrate/import", payload);
      if (!result.ok) {
        // Auth failures: leave the marker unset — next session retries
        // once the cookie is good.
        // eslint-disable-next-line no-console
        console.warn(
          `${LOG_PREFIX} import failed:`,
          result.error?.code,
          result.error?.message,
        );
        firedForUserRef.current = null;
        return;
      }

      const counts = result.data?.counts ?? null;
      writeMigrationMarker(userIdAtStart, counts);

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

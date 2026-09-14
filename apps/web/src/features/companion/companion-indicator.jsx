"use client";

/**
 * Tiny header indicator showing where /api/v1/* calls are going:
 *
 *   • source === "companion":  mint badge "Companion online"
 *   • source === "bundled" with `staleHostname` set:  lemon badge
 *     "Companion offline" (the user's heartbeat went stale; the
 *     catch-all fell back to the bundled API. Once the user reopens
 *     their companion app the chip flips back to mint within a
 *     heartbeat window).
 *   • source === "bundled" with no stale host: render nothing —
 *     espace devs without a companion shouldn't see UI for it.
 *
 * Mounted next to UserChip in the layout header.
 */

import { Badge } from "@/components/ui";
import { useApiOrigin } from "./use-api-origin.js";

export function CompanionIndicator() {
  const { source, hostname, staleHostname, lastSeenAt } = useApiOrigin();

  if (source === "companion" && hostname) {
    return (
      <Badge
        tone="mint"
        dot
        title={
          lastSeenAt
            ? `Companion last seen ${new Date(lastSeenAt).toLocaleTimeString()}.`
            : "Companion connected."
        }
      >
        Companion online
      </Badge>
    );
  }

  if (source === "bundled" && staleHostname) {
    return (
      <Badge
        tone="lemon"
        dot
        title={
          lastSeenAt
            ? `Last heartbeat ${new Date(lastSeenAt).toLocaleTimeString()}. Open your companion app to resume routing.`
            : "Open your companion app to resume routing."
        }
      >
        Companion offline
      </Badge>
    );
  }

  return null;
}

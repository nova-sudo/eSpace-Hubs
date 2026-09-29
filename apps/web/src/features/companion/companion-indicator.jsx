"use client";

/**
 * Tiny header indicator showing where /api/v1/* calls are going:
 *
 *   • source === "companion":  mint badge "Companion online"
 *   • source === "bundled" with `staleHostname` set:  lemon chip
 *     "Companion offline — open the desktop app", linking to the
 *     Companion settings tab (the user's heartbeat went stale; provider
 *     routes answer 502 until the companion is back). Once the user
 *     reopens their companion app the chip flips back to mint within a
 *     heartbeat window.
 *   • source === "bundled" with no stale host: render nothing —
 *     espace devs without a companion shouldn't see UI for it.
 *
 * Mounted next to UserChip in the layout header. The settings link is
 * derived from the current hub segment of the pathname — this feature
 * is a platform utility and mustn't import the hubs domain.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui";
import { useApiOrigin } from "./use-api-origin.js";

function companionSettingsHref(pathname) {
  const hub = (pathname || "").split("/").filter(Boolean)[0];
  return hub ? `/${hub}/settings?tab=companion` : "/";
}

export function CompanionIndicator() {
  const { source, hostname, staleHostname, lastSeenAt } = useApiOrigin();
  const pathname = usePathname();

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
      <Link
        href={companionSettingsHref(pathname)}
        className="inline-flex items-center rounded-[var(--radius-pill)] hover:opacity-80"
        title={
          lastSeenAt
            ? `Last heartbeat ${new Date(lastSeenAt).toLocaleTimeString()}. Provider data is unavailable until the desktop app is back.`
            : "Provider data is unavailable until the desktop app is back."
        }
      >
        <Badge tone="lemon" dot>
          Companion offline — open the desktop app
        </Badge>
      </Link>
    );
  }

  return null;
}

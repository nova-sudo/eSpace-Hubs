"use client";

/**
 * Page-level slot guard.
 *
 * Each page under app/[hub]/<slot>/ calls this on mount with its
 * slot id. If the active hub's `pages` map doesn't expose that slot,
 * the guard redirects to the hub's dashboard. Without it, a QA user
 * typing /qa/reviews would see the Dev review-log page rendered
 * under QA theming — confusing.
 *
 * Returns:
 *   true   — slot is exposed; render the page normally
 *   false  — slot is NOT exposed; a redirect is in flight, render nothing
 *
 * The redirect uses router.replace so the back button doesn't bounce
 * the user between the inaccessible URL and their dashboard.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useActiveHub } from "./hub-context.js";

export function useHubSlotGuard(slot) {
  const hub = useActiveHub();
  const router = useRouter();
  const exposed = Boolean(hub?.pages?.[slot]);

  useEffect(() => {
    if (!hub) return; // HubProvider still loading
    if (exposed) return;
    router.replace(`/${hub.id}`);
  }, [hub, exposed, router]);

  return exposed;
}

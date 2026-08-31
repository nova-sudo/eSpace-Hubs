"use client";

/**
 * Component form of useHubSlotGuard for routes whose page.jsx must stay a
 * Server Component (e.g. /[hub]/evidence carries `export const dynamic`,
 * which Next only honours in server files). Renders children only when
 * the active hub exposes the slot; otherwise the hook has already kicked
 * off a router.replace to the hub's dashboard.
 *
 * Closes hub-audit §3.1: /manager/evidence and /admin/goals rendered the
 * Dev surfaces because these two routes never checked their slot.
 */

import { useHubSlotGuard } from "./use-hub-slot-guard.js";

export function HubSlotGate({ slot, children }) {
  const exposed = useHubSlotGuard(slot);
  if (!exposed) return null;
  return children;
}

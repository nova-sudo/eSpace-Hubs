/**
 * Root page — never renders content of its own.
 *
 * Post-M10.2 every hub is mounted at /[hub]/..., so the root path
 * exists only to bounce the authenticated user to their primary hub.
 * Unauthenticated users get caught by the AuthGuard inside
 * <HubRedirect /> and routed to /login.
 *
 * Kept as a server component for the smallest possible bundle; the
 * actual logic lives in the client <HubRedirect /> component which
 * reads useSession() + useAvailableHubs() and calls router.replace().
 */

import { HubRedirect } from "@/features/hubs";

export const dynamic = "force-dynamic";

export default function Root() {
  return <HubRedirect />;
}

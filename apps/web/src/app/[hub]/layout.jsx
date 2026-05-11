/**
 * Hub-route layout. Wraps every page under /[hub]/... with:
 *
 *   1. AuthGuard       — bounces unauthenticated users to /login.
 *   2. HubProvider     — validates the URL slug against the registry
 *                        and the user's allowedHubs; applies the
 *                        hub's theme via CSS variable overrides; sets
 *                        HubContext so descendants can read the
 *                        active hub.
 *
 * Pages still wrap themselves in <AppShell /> — kept that decision
 * page-local so per-page chrome (footer toggle, etc.) doesn't get
 * shoved into the layout. The Header reads the active hub from
 * context and rewrites its nav prefixes accordingly (M10.2.b).
 *
 * Slug validation lives in HubProvider, not here, so an unknown slug
 * still gets a quiet placeholder and a router.replace() — no error
 * boundary, no flash of the wrong content.
 */

import { AuthGuard } from "@/features/auth";
import { HubProvider } from "@/features/hubs";

export const dynamic = "force-dynamic";

export default async function HubLayout({ children, params }) {
  // Next 16: params is a Promise on dynamic segments. Awaiting here
  // keeps the destructure clean for the client tree below.
  const { hub } = await params;
  return (
    <AuthGuard>
      <HubProvider hubSlug={hub}>{children}</HubProvider>
    </AuthGuard>
  );
}

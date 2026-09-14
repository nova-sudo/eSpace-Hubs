/**
 * Root page. The marketing landing page is retired (docs/design-system-v2.md
 * §9). A logged-OUT visitor is redirected to /login; a logged-IN user is
 * bounced to their hub (or the hub picker). The decision lives in the
 * client <RootGate /> which reads useSession().
 *
 * Kept as a thin server component; RootGate does the auth branch client-side.
 */

import { RootGate } from "@/features/hubs";

export const dynamic = "force-dynamic";

export default function Root() {
  return <RootGate />;
}

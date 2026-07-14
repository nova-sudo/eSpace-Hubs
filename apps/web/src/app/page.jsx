/**
 * Root page. Logged-OUT visitors get the public marketing landing page;
 * logged-IN users are bounced to their hub (or the hub picker). The decision
 * lives in the client <RootGate /> which reads useSession(); the landing's CTAs
 * all route to /login.
 *
 * Kept as a thin server component; RootGate does the auth branch client-side.
 */

import { RootGate } from "@/features/landing";

export const dynamic = "force-dynamic";

export default function Root() {
  return <RootGate />;
}

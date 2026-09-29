/**
 * /companion/pair?code=… — companion-device approval page.
 *
 * Surfaces a pending pairing the user's companion app initiated. The
 * user sees the device name + the IP that called /pair/start, and
 * clicks Approve / Cancel. Approve issues
 * POST /api/v1/companion/pair/approve which mints a bearer token
 * on the server and surfaces it to the companion via its /pair/poll
 * stream.
 *
 * Auth: the user MUST be logged in. This route is NOT wrapped in
 * AuthGuard (it's a one-shot dialog outside the hub shell), so a
 * logged-out user who opens the link from the companion lands here
 * cold. <SignInGate> gives them a sign-in link that carries this exact
 * URL (pairing code included) as `?next=`, so they come straight back
 * after login.
 *
 * No AppShell / no hub theme — this is a one-shot confirmation
 * dialog, not a hub page. Mirrors /accept-invite's framing.
 */

import { Suspense } from "react";
import { SignInGate } from "@/features/auth";
import { CompanionPairForm } from "@/features/companion";

export const dynamic = "force-dynamic";

export default function CompanionPairPage() {
  return (
    <main className="flex min-h-screen flex-col bg-bg text-fg">
      <Suspense fallback={null}>
        <SignInGate reason="You need to be signed in to your eSpace Hubs account before you can approve a companion device.">
          <CompanionPairForm />
        </SignInGate>
      </Suspense>
    </main>
  );
}

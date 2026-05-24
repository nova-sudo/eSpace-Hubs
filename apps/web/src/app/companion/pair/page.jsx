"use client";

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
 * Auth: the user MUST be logged in. AuthGuard at the layout level
 * trips them through /login first if they aren't — after login they
 * return here via the standard `?next=` redirect.
 *
 * No AppShell / no hub theme — this is a one-shot confirmation
 * dialog, not a hub page. Mirrors /accept-invite's framing.
 */

import { Suspense } from "react";
import { CompanionPairForm } from "@/features/companion";

export const dynamic = "force-dynamic";

export default function CompanionPairPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--fg)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Suspense fallback={null}>
        <CompanionPairForm />
      </Suspense>
    </main>
  );
}

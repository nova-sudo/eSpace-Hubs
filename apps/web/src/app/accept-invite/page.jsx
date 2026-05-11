"use client";

/**
 * /accept-invite?token=… — invite redemption page.
 *
 * Mirrors /login's structure: top-level route, no AppShell, no hub
 * theme. The form is the only thing on the page. AcceptInviteForm
 * reads the token from the query string and POSTs to
 * /api/v1/auth/accept-invite, which mints a session cookie on
 * success — the user lands logged-in without bouncing through
 * /login again. The AuthGuard then routes them to /onboarding via
 * the M-OB gate.
 *
 * No AuthGuard wrapping here — accept-invite is the entry-point
 * for users who DON'T yet have a session, and wrapping would
 * bounce them to /login (creating a loop with the invite email
 * link).
 *
 * useSearchParams() forces a client-side render bailout, so the
 * form is mounted inside a Suspense boundary the same way the
 * /login page handles its `?next=` param.
 */

import { Suspense } from "react";
import { AcceptInviteForm } from "@/features/auth";

export const dynamic = "force-dynamic";

export default function AcceptInvitePage() {
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
        <AcceptInviteForm />
      </Suspense>
    </main>
  );
}

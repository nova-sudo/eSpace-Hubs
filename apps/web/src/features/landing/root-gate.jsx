"use client";

/**
 * Root-route gate. Decides what `/` renders:
 *   - session restoring → a dark placeholder (no white flash, no wrong-content
 *     flash for authed users about to be redirected)
 *   - logged OUT        → the public marketing <LandingPage />
 *   - logged IN         → <HubRedirect /> (bounce to the user's hub / picker)
 *
 * This replaces the old root behaviour where an unauthenticated visitor to `/`
 * was bounced straight to /login — now they get the landing, whose CTAs link to
 * /login. NOTE: `/` is whitelisted in api-client's PUBLIC_AUTH_PATHS so the
 * unauthenticated /auth/me 401 doesn't hard-redirect the visitor off the
 * landing before this gate can render it.
 */

import { useSession } from "@/features/auth";
import { HubRedirect } from "@/features/hubs";
import { LandingPage } from "./landing-page";

export function RootGate() {
  const { user, loading } = useSession();

  if (loading) {
    // Dark placeholder — matches both the landing canvas and the dark app
    // default, so the resolve is seamless whichever way it goes.
    return <div style={{ minHeight: "100vh", background: "#050505" }} aria-busy="true" />;
  }
  if (!user) return <LandingPage />;
  return <HubRedirect />;
}

export default RootGate;

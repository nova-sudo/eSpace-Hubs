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
    // Theme-token placeholder (#239): the hard-coded #050505 flashed a
    // black screen at every light-theme user on every load. The no-flash
    // script stamps data-theme on <html> before first paint, so var(--bg)
    // already resolves to the user's actual canvas here. A signed-OUT
    // visitor resolves to the dark landing next — that hand-off was the
    // only case the old hard-code served, and dark-preference users still
    // get it via the token.
    return <div style={{ minHeight: "100vh", background: "var(--bg)" }} aria-busy="true" />;
  }
  if (!user) return <LandingPage />;
  return <HubRedirect />;
}

export default RootGate;

"use client";

/**
 * Root-route gate. The marketing landing page is retired — `/` for a
 * signed-out visitor redirects straight to `/login`; a signed-in user is
 * bounced to their hub (or the hub picker) via `<HubRedirect />`.
 *
 *   session restoring → a themed placeholder (no white flash)
 *   logged OUT        → redirect to /login
 *   logged IN         → <HubRedirect />
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/features/auth";
import { HubRedirect } from "./hub-redirect.jsx";

export function RootGate() {
  const { user, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (loading || user) return;
    router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return <div style={{ minHeight: "100vh", background: "var(--bg)" }} aria-busy="true" />;
  }
  return <HubRedirect />;
}

export default RootGate;

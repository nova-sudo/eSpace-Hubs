"use client";

/**
 * Root-page redirector. Mounted at /page.jsx. Sends the user to their
 * primary hub once we know who they are and which hub they prefer.
 *
 * Decision matrix:
 *   session.loading       → render a quiet placeholder
 *   session.user == null  → AuthGuard handles it (renders /login)
 *   hubs.status="loading" → placeholder
 *   hubs.status="ready"   → router.replace(`/${primaryHubId}`)
 *   hubs.status="error"   → placeholder + log (next session retry)
 *
 * The redirect uses replace() so the back button doesn't bounce the
 * user between `/` and `/dev`.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession, AuthGuard } from "@/features/auth";
import { useAvailableHubs } from "./use-available-hubs";

export function HubRedirect() {
  return (
    <AuthGuard>
      <HubRedirectInner />
    </AuthGuard>
  );
}

function HubRedirectInner() {
  const router = useRouter();
  const { user, loading: sessionLoading } = useSession();
  const { status, primaryHubId, defaultHubId, hubs } = useAvailableHubs();

  useEffect(() => {
    if (sessionLoading || !user) return;
    if (status !== "ready") return;
    const target = primaryHubId || hubs[0]?.id || defaultHubId;
    if (target) {
      router.replace(`/${target}`);
    }
  }, [sessionLoading, user, status, primaryHubId, defaultHubId, hubs, router]);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--muted-fg)",
        display: "grid",
        placeItems: "center",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
      }}
      aria-busy="true"
    >
      Loading…
    </main>
  );
}

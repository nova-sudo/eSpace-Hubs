"use client";

/**
 * Root-page dispatcher. Mounted at /page.jsx. Decides where an
 * authenticated user lands.
 *
 * Decision matrix:
 *   session.loading       → quiet placeholder
 *   session.user == null  → AuthGuard handles it (→ /login)
 *   hubs.status="loading" → placeholder
 *   hubs.status="error"   → placeholder (next session retries)
 *   0 allowed hubs        → placeholder (the resolver fallback in
 *                            /hubs/me would normally never let this
 *                            happen)
 *   1 allowed hub         → router.replace(`/${hub.id}`)
 *   >1 hubs, valid pick   → router.replace(`/${pickedHubId}`)
 *   >1 hubs, no pick      → render <HubPicker /> (the user picks
 *                            interactively; pick is stored in
 *                            localStorage with a 24h TTL)
 *
 * Replace (not push) so the back button doesn't bounce the user
 * between `/` and `/<hub>`.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession, AuthGuard } from "@/features/auth";
import { useAvailableHubs } from "./use-available-hubs";
import { getValidPick } from "./hub-pick-store.js";
import { HubPicker } from "./hub-picker.jsx";

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

  // Compute the redirect target. `null` means "render the picker".
  let target = null;
  if (status === "ready" && Array.isArray(hubs) && hubs.length > 0) {
    if (hubs.length === 1) {
      target = `/${hubs[0].id}`;
    } else {
      const allowedIds = hubs.map((h) => h.id);
      const picked = getValidPick(allowedIds);
      if (picked) {
        target = `/${picked}`;
      }
      // else: multi-hub user with no recent pick → render the
      // picker (target stays null).
    }
  }

  useEffect(() => {
    if (sessionLoading || !user) return;
    if (status !== "ready") return;
    if (target) router.replace(target);
  }, [sessionLoading, user, status, target, router]);

  // Render the picker when we're done loading and there's no
  // resolved target (multi-hub, no recent pick).
  if (
    !sessionLoading &&
    user &&
    status === "ready" &&
    hubs.length > 1 &&
    !target
  ) {
    return <HubPicker hubs={hubs} primaryHubId={primaryHubId} />;
  }

  // Single-hub or redirect-in-flight: small loading placeholder.
  // `defaultHubId` referenced here purely to keep its existing
  // import live for future use (audit trails consume it).
  void defaultHubId;
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

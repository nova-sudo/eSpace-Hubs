"use client";

/**
 * Root-page dispatcher. Mounted at /page.jsx. Decides where an
 * authenticated user lands.
 *
 * Decision matrix:
 *   session.loading       → quiet placeholder
 *   session.user == null  → AuthGuard handles it (→ /login)
 *   hubs.status="loading" → placeholder
 *   hubs.status="error"   → "Couldn't load your hubs" card with
 *                            Retry (refetchHubs) + Sign out
 *   0 allowed hubs        → same card (the resolver fallback in
 *                            /hubs/me would normally never let this
 *                            happen — but "Loading…" forever is the
 *                            wrong answer when it does)
 *   1 allowed hub         → router.replace(`/${hub.id}`)
 *   >1 hubs, valid pick   → router.replace(`/${pickedHubId}`)
 *   >1 hubs, no pick      → render <HubPicker /> (the user picks
 *                            interactively; pick is stored in
 *                            localStorage with a 24h TTL)
 *
 * Replace (not push) so the back button doesn't bounce the user
 * between `/` and `/<hub>`.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Loading } from "@/components/ui";
import { useSession, AuthGuard } from "@/features/auth";
import { useAvailableHubs } from "./use-available-hubs";
import { getValidPick } from "./hub-pick-store.js";
import { refetchHubs } from "./hubs-store.js";
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
  const { user, loading: sessionLoading, logout } = useSession();
  const { status, primaryHubId, defaultHubId, hubs, error } = useAvailableHubs();

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

  // Fetch failed, or the server says this account has no hub at all:
  // give the user the reason and two ways out instead of a spinner that
  // never resolves.
  if (!sessionLoading && user && (status === "error" || (status === "ready" && hubs.length === 0))) {
    return (
      <HubsUnavailable
        error={status === "error" ? error : null}
        onRetry={refetchHubs}
        onSignOut={async () => {
          await logout();
          router.replace("/login");
        }}
      />
    );
  }

  // Single-hub or redirect-in-flight: small loading placeholder.
  // `defaultHubId` referenced here purely to keep its existing
  // import live for future use (audit trails consume it).
  void defaultHubId;
  return (
    <main className="grid min-h-screen place-items-center bg-bg" aria-busy="true">
      <Loading label="Loading…" />
    </main>
  );
}

/**
 * The "no hub" / "couldn't load hubs" screen. Also rendered by HubProvider
 * when a signed-in user lands on a hub URL with no hub they may enter.
 */
export function HubsUnavailable({ error, onRetry, onSignOut }) {
  const [signingOut, setSigningOut] = useState(false);
  // Two different situations: the request failed (retry may help), or it
  // worked and this account simply has no hub yet (only an admin can help).
  const title = error ? "Couldn't load your hubs" : "You don't have access to a hub yet";
  const body = error
    ? error.message || "The server didn't respond. Check your connection and try again."
    : "Your account is active, but no hub has been assigned to it. Ask an admin to give you a role (for example Developer), then check again.";
  return (
    <main className="grid min-h-screen place-items-center bg-bg px-4">
      <Card padding={40} className="flex w-full max-w-[440px] flex-col items-center gap-4 text-center">
        <h1 className="text-[15px] font-bold text-fg">{title}</h1>
        <p className="max-w-[42ch] text-[13px] leading-[1.5] text-muted-fg">{body}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={onRetry}>{error ? "Retry" : "Check again"}</Button>
          <Button
            variant="soft"
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              void onSignOut();
            }}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </Button>
        </div>
      </Card>
    </main>
  );
}

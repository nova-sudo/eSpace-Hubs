"use client";

/**
 * Auth + onboarding gate for protected pages.
 *
 * Behaviour
 *   NEXT_PUBLIC_AUTH_REQUIRED=false (default) → renders children as-is,
 *     no redirects. Existing dev flows + the legacy localStorage path
 *     keep working without a login.
 *
 *   NEXT_PUBLIC_AUTH_REQUIRED=true →
 *     1. while loading initial /me, render a placeholder
 *     2. no session OR partial session (needsTotp) → redirect to /login
 *     3. authenticated but onboarding incomplete → redirect to /onboarding
 *     4. otherwise render children
 *
 * The /login page and /onboarding page intentionally do NOT wrap
 * themselves in AuthGuard's full chain to avoid redirect loops:
 *   - /login skips AuthGuard entirely
 *   - /onboarding wraps in AuthGuard but its own `OnboardingPage` is
 *     a no-op for the onboarding-incomplete branch (since we'd be
 *     redirecting to where we already are). We detect "the page is
 *     /onboarding" and skip the onboarding-redirect step.
 */

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useSession } from "./use-session.js";

const AUTH_REQUIRED =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_AUTH_REQUIRED === "true";

const ONBOARDING_PATH = "/onboarding";

export function AuthGuard({ children, fallback = null }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, needsTotp } = useSession();

  const needsLoginRedirect =
    AUTH_REQUIRED && !loading && (!user || needsTotp);

  // M-OB gate: authenticated but onboarding never completed →
  // route to /onboarding. Skip when we're ALREADY on /onboarding to
  // avoid a redirect loop.
  const needsOnboardingRedirect =
    AUTH_REQUIRED &&
    !loading &&
    !!user &&
    !needsTotp &&
    !user.onboardingCompletedAt &&
    pathname !== ONBOARDING_PATH;

  useEffect(() => {
    if (needsLoginRedirect) {
      const target = `/login${
        pathname && pathname !== "/login"
          ? `?next=${encodeURIComponent(pathname)}`
          : ""
      }`;
      router.replace(target);
      return;
    }
    if (needsOnboardingRedirect) {
      router.replace(ONBOARDING_PATH);
    }
  }, [needsLoginRedirect, needsOnboardingRedirect, pathname, router]);

  if (!AUTH_REQUIRED) return children;
  if (loading) return fallback ?? <AuthLoading />;
  if (!user || needsTotp) return fallback ?? <AuthLoading />;
  if (needsOnboardingRedirect) return fallback ?? <AuthLoading />;
  return children;
}

function AuthLoading() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        color: "var(--muted-fg)",
      }}
    >
      Authenticating…
    </div>
  );
}

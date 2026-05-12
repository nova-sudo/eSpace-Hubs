"use client";

/**
 * Auth + TOTP-enrolment + onboarding gate for protected pages.
 *
 * Behaviour
 *   NEXT_PUBLIC_AUTH_REQUIRED=false (default) → renders children as-is,
 *     no redirects. Existing dev flows + the legacy localStorage path
 *     keep working without a login.
 *
 *   NEXT_PUBLIC_AUTH_REQUIRED=true →
 *     1. while loading initial /me, render a placeholder
 *     2. no session OR partial session (needsTotp) → redirect to /login
 *     3. authenticated but TOTP not enrolled → redirect to /totp-setup
 *     4. authenticated + TOTP enrolled but onboarding incomplete →
 *        redirect to /onboarding
 *     5. otherwise render children
 *
 * Order matters: TOTP comes BEFORE onboarding so we establish 2FA
 * before the user enters profile / PII fields. A hijacked password
 * shouldn't be able to read or write that information.
 *
 * Trap-pages skip their own redirect step to avoid loops:
 *   - /login skips AuthGuard entirely
 *   - /totp-setup wraps in AuthGuard; the totp-enrol-redirect step
 *     no-ops when pathname is /totp-setup
 *   - /onboarding wraps in AuthGuard; the onboarding-redirect step
 *     no-ops when pathname is /onboarding (but the totp gate still
 *     fires — a user who's on /onboarding without TOTP enrolled
 *     gets bounced to /totp-setup, which is correct)
 */

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useSession } from "./use-session.js";

const AUTH_REQUIRED =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_AUTH_REQUIRED === "true";

const TOTP_SETUP_PATH = "/totp-setup";
const ONBOARDING_PATH = "/onboarding";

export function AuthGuard({ children, fallback = null }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, needsTotp } = useSession();

  const needsLoginRedirect =
    AUTH_REQUIRED && !loading && (!user || needsTotp);

  // 2FA gate: authenticated but the user has no TOTP secret on file →
  // trap them at /totp-setup. The session is fully verified at the
  // server level (totpVerified: true was set at login because there
  // was nothing to verify), but app access still requires enrolment
  // by policy. Skip when we're ALREADY on /totp-setup to avoid a
  // redirect loop.
  const needsTotpSetupRedirect =
    AUTH_REQUIRED &&
    !loading &&
    !!user &&
    !needsTotp &&
    !user.totpEnrolled &&
    pathname !== TOTP_SETUP_PATH;

  // M-OB gate: authenticated, TOTP enrolled, but onboarding never
  // completed → route to /onboarding. Skip when we're ALREADY on
  // /onboarding. The TOTP gate above takes precedence so a user
  // who's not enrolled gets bounced to /totp-setup first.
  const needsOnboardingRedirect =
    AUTH_REQUIRED &&
    !loading &&
    !!user &&
    !needsTotp &&
    !!user.totpEnrolled &&
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
    if (needsTotpSetupRedirect) {
      router.replace(TOTP_SETUP_PATH);
      return;
    }
    if (needsOnboardingRedirect) {
      router.replace(ONBOARDING_PATH);
    }
  }, [
    needsLoginRedirect,
    needsTotpSetupRedirect,
    needsOnboardingRedirect,
    pathname,
    router,
  ]);

  if (!AUTH_REQUIRED) return children;
  if (loading) return fallback ?? <AuthLoading />;
  if (!user || needsTotp) return fallback ?? <AuthLoading />;
  if (needsTotpSetupRedirect) return fallback ?? <AuthLoading />;
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

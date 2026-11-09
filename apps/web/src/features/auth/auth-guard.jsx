"use client";

/**
 * Auth + TOTP-enrolment + onboarding gate for protected pages.
 *
 * Behaviour
 *   NEXT_PUBLIC_AUTH_REQUIRED="false" → renders children as-is, no
 *     redirects. Opt-OUT only: for local dev / the legacy localStorage
 *     path, and it must be set explicitly. BL-017: the default used to
 *     be false, which meant a production build that simply forgot the
 *     var served every hub with no login.
 *
 *   NEXT_PUBLIC_AUTH_REQUIRED unset or "true" (default: required) →
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
import { Loading } from "@/components/ui";
import { guardTarget } from "./guard-target.js";
import { useSession } from "./use-session.js";

// Fail CLOSED: auth is required unless the flag is EXPLICITLY "false".
// An unset var in a production build must never mean "no login".
const AUTH_REQUIRED =
  typeof process === "undefined" ||
  process.env.NEXT_PUBLIC_AUTH_REQUIRED !== "false";

if (
  !AUTH_REQUIRED &&
  typeof process !== "undefined" &&
  process.env.NODE_ENV === "production"
) {
  // eslint-disable-next-line no-console
  console.warn(
    "[auth-guard] NEXT_PUBLIC_AUTH_REQUIRED=false in a production build — every hub is served without a login.",
  );
}

export function AuthGuard({ children, fallback = null }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, needsTotp } = useSession();

  // The whole redirect chain (login → verify email → 2FA setup →
  // onboarding) lives in guard-target.js so it is testable.
  const target =
    AUTH_REQUIRED && !loading ? guardTarget({ user, needsTotp, pathname }) : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  if (!AUTH_REQUIRED) return children;
  if (loading || target) return fallback ?? <AuthLoading />;
  return children;
}

function AuthLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <Loading label="Authenticating…" />
    </div>
  );
}

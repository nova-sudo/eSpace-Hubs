"use client";

/**
 * Auth gate for protected pages.
 *
 * Behaviour
 *   NEXT_PUBLIC_AUTH_REQUIRED=false (default) → renders children as-is,
 *     no redirects. Existing dev flows + the legacy localStorage path
 *     keep working without a login. This is the M-series transition
 *     escape hatch the plan documents.
 *
 *   NEXT_PUBLIC_AUTH_REQUIRED=true →
 *     - while loading initial /me, render a small placeholder
 *     - if no session OR partial session (needsTotp), redirect to
 *       /login. The login form will surface the right step.
 *     - else render children.
 *
 * Each page-level layout can wrap its content with this; the /login
 * page deliberately does NOT, so there's no redirect loop.
 */

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useSession } from "./use-session.js";

const AUTH_REQUIRED =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_AUTH_REQUIRED === "true";

export function AuthGuard({ children, fallback = null }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, needsTotp } = useSession();

  const shouldRedirect = AUTH_REQUIRED && !loading && (!user || needsTotp);

  useEffect(() => {
    if (!shouldRedirect) return;
    // Preserve the post-login destination so the login page can bounce
    // back. Use a query param rather than state — survives a hard
    // refresh during dev.
    const target = `/login${
      pathname && pathname !== "/login"
        ? `?next=${encodeURIComponent(pathname)}`
        : ""
    }`;
    router.replace(target);
  }, [shouldRedirect, pathname, router]);

  if (!AUTH_REQUIRED) return children;
  if (loading) return fallback ?? <AuthLoading />;
  if (!user || needsTotp) return fallback ?? <AuthLoading />;
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

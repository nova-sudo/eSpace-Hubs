"use client";

/**
 * /password-reset?token=… — landing page for the reset email link.
 *
 * Mirror of /accept-invite's structure (top-level route, no AppShell,
 * no AuthGuard wrap — the user redeeming a reset link is by
 * definition signed out). The form reads the token from the query
 * string, captures the new password, and on success redirects to
 * /login where the user can sign in fresh.
 *
 * Suspense boundary because useSearchParams() forces a client-side
 * render bailout — Next.js refuses to silently prerender that, so
 * without the boundary `next build` errors on this route. Same
 * pattern as /accept-invite and /login.
 */

import { Suspense } from "react";
import { PasswordResetForm } from "@/features/auth";

export const dynamic = "force-dynamic";

export default function PasswordResetPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--fg)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Suspense fallback={null}>
        <PasswordResetForm />
      </Suspense>
    </main>
  );
}

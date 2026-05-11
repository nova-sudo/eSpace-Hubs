"use client";

/**
 * /login — the sign-in page. The LoginForm handles both steps
 * (email/password and TOTP); this page just provides the surrounding
 * chrome and the post-login redirect.
 *
 * Redirect target precedence:
 *   1. `?next=...` query param (set by AuthGuard when it bounced)
 *   2. "/" (dashboard) when no hint
 *
 * The form is wrapped in a <Suspense> boundary because `useSearchParams`
 * forces a client-side rendering bailout that Next.js refuses to silently
 * prerender — without the boundary, `next build` errors on this route.
 */

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoginForm } from "@/features/auth";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  return (
    <LoginForm
      onSuccess={() => {
        // Hard-replace so the address bar reflects the destination.
        router.replace(next);
      }}
    />
  );
}

export default function LoginPage() {
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
        <LoginInner />
      </Suspense>
    </main>
  );
}

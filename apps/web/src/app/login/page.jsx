"use client";

/**
 * /login — the sign-in page. The LoginForm handles both steps
 * (email/password and TOTP); this page just provides the surrounding
 * chrome and the post-login redirect.
 *
 * Redirect target precedence:
 *   1. `?next=...` query param (set by AuthGuard when it bounced)
 *   2. "/" (dashboard) when no hint
 */

import { useRouter, useSearchParams } from "next/navigation";
import { LoginForm } from "@/features/auth";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

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
      <LoginForm
        onSuccess={() => {
          // Hard-replace so the address bar reflects the destination.
          router.replace(next);
        }}
      />
    </main>
  );
}

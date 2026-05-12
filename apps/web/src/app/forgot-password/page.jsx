"use client";

/**
 * /forgot-password — entry point for the password-reset flow.
 *
 * Sibling of /login and /accept-invite. No AppShell, no hub theme,
 * no AuthGuard — the entire purpose is to be reachable WITHOUT a
 * session. Wrapping it in AuthGuard would bounce a locked-out user
 * back to /login, defeating the point.
 *
 * The form does its own POST + success-state handling; this page is
 * just the surrounding chrome.
 */

import { PasswordResetRequestForm } from "@/features/auth";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
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
      <PasswordResetRequestForm />
    </main>
  );
}

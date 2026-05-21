"use client";

/**
 * /waiting-approval — landing page for self-sign-up users while admin
 * promotes them to "active". Wrapped in AuthGuard so unauthenticated
 * users get bounced to /login; the guard's `pending_admin` branch
 * skips its own redirect when pathname is already /waiting-approval
 * (no loop).
 */

import { AuthGuard, WaitingApproval } from "@/features/auth";

export default function WaitingApprovalPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--fg)",
      }}
    >
      <AuthGuard>
        <WaitingApproval />
      </AuthGuard>
    </main>
  );
}

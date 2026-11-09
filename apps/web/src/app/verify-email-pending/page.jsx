"use client";

/**
 * /verify-email-pending — "check your inbox". AuthGuard parks
 * pending_email users here and lets everyone else through to "/".
 */

import { AuthGuard, VerifyEmailPending } from "@/features/auth";

export default function VerifyEmailPendingPage() {
  return (
    <AuthGuard>
      <VerifyEmailPending />
    </AuthGuard>
  );
}

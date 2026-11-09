"use client";

/**
 * /verify-email?token=… — the link in the verification email. No
 * AuthGuard: the link is often opened where there is no session.
 * useSearchParams() needs a Suspense boundary (same as /accept-invite).
 */

import { Suspense } from "react";
import { VerifyEmailView } from "@/features/auth";

export const dynamic = "force-dynamic";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailView />
    </Suspense>
  );
}

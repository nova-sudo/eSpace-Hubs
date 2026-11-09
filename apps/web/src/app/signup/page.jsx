"use client";

/**
 * /signup — self-serve account creation. Public; no AuthGuard.
 *
 * On success the SignupForm pushes the new user into the session
 * store, so when we navigate away the AuthGuard sees an authenticated
 * user and walks them through /verify-email-pending → (link) →
 * /totp-setup → /onboarding → their hub.
 */

import { useRouter } from "next/navigation";
import { SignupForm } from "@/features/auth";

export default function SignupPage() {
  const router = useRouter();
  return (
    <SignupForm
      onSuccess={() => {
        // AuthGuard on the destination will route them through
        // /verify-email-pending → /totp-setup → /onboarding. Land on
        // the dashboard root so that chain has a starting point.
        router.replace("/");
      }}
    />
  );
}

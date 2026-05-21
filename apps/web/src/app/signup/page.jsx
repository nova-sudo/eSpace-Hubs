"use client";

/**
 * /signup — self-serve account creation. Public; no AuthGuard.
 *
 * On success the SignupForm pushes the new user into the session
 * store, so when we navigate away the AuthGuard sees an authenticated
 * user and walks them through /totp-setup → /onboarding →
 * /waiting-approval (status="pending_admin").
 */

import { useRouter } from "next/navigation";
import { SignupForm } from "@/features/auth";

export default function SignupPage() {
  const router = useRouter();
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
      <SignupForm
        onSuccess={() => {
          // AuthGuard on the destination will route them through
          // /totp-setup → /onboarding → /waiting-approval. Land on
          // the dashboard root so that chain has a starting point.
          router.replace("/");
        }}
      />
    </main>
  );
}

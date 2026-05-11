/**
 * /onboarding — M-OB form.
 *
 * Deliberately renders OUTSIDE the AppShell (no header, no footer, no
 * hub theme). The form is its own visual world — a transitional page
 * between authentication and the hub the user lands in. Wrapping it
 * in AppShell would show navigation tabs to pages the user can't yet
 * meaningfully use.
 *
 * AuthGuard handles unauthenticated visitors (bounces to /login).
 * The HubRedirect at /page.jsx + the AuthGuard's onboarding gate
 * ensure users who haven't completed the form get trapped here
 * regardless of which URL they typed.
 */

import { AuthGuard } from "@/features/auth";
import { OnboardingPage } from "@/features/onboarding";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <AuthGuard>
      <OnboardingPage />
    </AuthGuard>
  );
}

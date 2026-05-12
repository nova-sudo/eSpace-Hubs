/**
 * /totp-setup — TOTP enrolment gate for users who don't yet have 2FA.
 *
 * Mirrors /onboarding's shape: top-level route, AuthGuard wrapper, no
 * AppShell, no hub theme. Renders outside the app chrome because the
 * user can't meaningfully reach any hub yet — the AuthGuard traps
 * them here until they enrol.
 *
 * The guard's logic detects pathname === "/totp-setup" and SKIPS the
 * "redirect to /totp-setup" step that fires elsewhere, avoiding a
 * redirect loop. Pattern matches /onboarding.
 *
 * Why this comes BEFORE /onboarding in the auth chain: establishing
 * 2FA before collecting PII (department, employee id, hub picks)
 * means a hijacked password can't read or write that information,
 * which is the whole point of the second factor.
 */

import { AuthGuard } from "@/features/auth";
import { TotpSetupForm } from "@/features/auth";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <AuthGuard>
      <main
        style={{
          minHeight: "100vh",
          background: "var(--bg)",
          color: "var(--fg)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <TotpSetupForm />
      </main>
    </AuthGuard>
  );
}

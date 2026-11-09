/**
 * Where AuthGuard should send the current user — pure, so the chain is
 * testable without React. `null` = render the page.
 *
 * Order (first match wins):
 *   1. no user / TOTP step pending          → /login?next=…
 *   2. email not verified (pending_email)   → /verify-email-pending
 *   3. verified but sitting on that screen  → /
 *   4. no TOTP enrolled                     → /totp-setup
 *   5. enrolled but on /totp-setup          → /
 *   6. onboarding not completed             → /onboarding
 *
 * There is no approval step: self-signups are active once verified.
 */

export const TOTP_SETUP_PATH = "/totp-setup";
export const ONBOARDING_PATH = "/onboarding";
export const VERIFY_PENDING_PATH = "/verify-email-pending";

export function guardTarget({ user, needsTotp = false, pathname }) {
  if (!user || needsTotp) {
    return pathname && pathname !== "/login"
      ? `/login?next=${encodeURIComponent(pathname)}`
      : "/login";
  }
  if (user.status === "pending_email") {
    return pathname === VERIFY_PENDING_PATH ? null : VERIFY_PENDING_PATH;
  }
  if (pathname === VERIFY_PENDING_PATH) return "/";
  if (!user.totpEnrolled) {
    return pathname === TOTP_SETUP_PATH ? null : TOTP_SETUP_PATH;
  }
  if (pathname === TOTP_SETUP_PATH) return "/";
  if (!user.onboardingCompletedAt) {
    return pathname === ONBOARDING_PATH ? null : ONBOARDING_PATH;
  }
  return null;
}

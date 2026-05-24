/**
 * Barrel for the auth feature. Public API:
 *
 *   useSession()                 — reactive session state + login/logout/refresh
 *   <SessionProvider>            — mount once at the root layout
 *   <LoginForm>                  — used by /login page (and reusable elsewhere)
 *   <AcceptInviteForm>           — used by /accept-invite page
 *   <PasswordResetRequestForm>   — used by /forgot-password page
 *   <PasswordResetForm>          — used by /password-reset?token=… page
 *   <TotpSetupForm>              — used by /totp-setup page
 *   <AuthGuard>                  — wraps protected page contents
 *   <UserChip>                   — header chip showing the session user + logout
 *   <RequireCapability>          — gate child elements on a capability check
 *   hasCapability/hasAllCapabilities — non-React reader helpers
 */

export { useSession } from "./use-session.js";
export {
  clearAllUserScopedStorage,
  USER_SCOPED_LOCAL_STORAGE_KEYS,
} from "./clear-user-storage.js";
export { useMyEngagementConfig } from "./use-engagement-config.js";
export { SessionProvider } from "./session-provider.jsx";
export { LoginForm } from "./login-form.jsx";
export { AcceptInviteForm } from "./accept-invite-form.jsx";
export { PasswordResetRequestForm } from "./password-reset-request-form.jsx";
export { PasswordResetForm } from "./password-reset-form.jsx";
export { TotpSetupForm } from "./totp-setup-form.jsx";
export { SignupForm } from "./signup-form.jsx";
export { WaitingApproval } from "./waiting-approval.jsx";
export { AuthGuard } from "./auth-guard.jsx";
export { UserChip } from "./user-chip.jsx";
export {
  RequireCapability,
  hasCapability,
  hasAllCapabilities,
} from "./require-capability.jsx";

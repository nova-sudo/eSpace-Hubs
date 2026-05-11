/**
 * Barrel for the auth feature. Public API:
 *
 *   useSession()         — reactive session state + login/logout/refresh
 *   <SessionProvider>    — mount once at the root layout
 *   <LoginForm>          — used by /login page (and reusable elsewhere)
 *   <AcceptInviteForm>   — used by /accept-invite page
 *   <AuthGuard>          — wraps protected page contents
 *   <UserChip>           — header chip showing the session user + logout
 */

export { useSession } from "./use-session.js";
export { SessionProvider } from "./session-provider.jsx";
export { LoginForm } from "./login-form.jsx";
export { AcceptInviteForm } from "./accept-invite-form.jsx";
export { AuthGuard } from "./auth-guard.jsx";
export { UserChip } from "./user-chip.jsx";

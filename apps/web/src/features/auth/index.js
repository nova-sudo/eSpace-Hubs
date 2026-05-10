/**
 * Barrel for the auth feature. Public API:
 *
 *   useSession()        — reactive session state + login/logout/refresh
 *   <SessionProvider>   — mount once at the root layout
 *   <LoginForm>         — used by /login page (and reusable elsewhere)
 *   <AuthGuard>         — wraps protected page contents
 */

export { useSession } from "./use-session.js";
export { SessionProvider } from "./session-provider.jsx";
export { LoginForm } from "./login-form.jsx";
export { AuthGuard } from "./auth-guard.jsx";

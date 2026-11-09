"use client";

/**
 * Self-serve signup form.
 *
 *   email + password + display name (+ signup code for other domains)
 *     → POST /api/v1/auth/signup
 *     → server creates a `pending_email` user, mints a session and
 *       sends a verification link
 *     → AuthGuard routes them to /verify-email-pending, then (after
 *       the link) /totp-setup → /onboarding → their hub
 *
 * Free-domain emails (SIGNUP_FREE_DOMAINS, espace.com.eg) never see
 * the code field; any other domain needs a code from an admin. The
 * field also appears if the server answers `signup_code_required`.
 */

import { useState } from "react";
import Link from "next/link";
import { apiPost } from "@/lib/api-client";
import { Button, Field, Input } from "@/components/ui";
import { AuthCard, AuthError } from "./auth-card.jsx";
import { setSession } from "./session-store.js";
import { clearAllUserScopedStorage } from "./clear-user-storage.js";
import { needsSignupCode } from "./free-domains.js";

// Matches accept-invite / password-reset and the API's newPassword rule.
const MIN_PASSWORD_LENGTH = 12;

export function SignupForm({ onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [signupCode, setSignupCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [serverWantsCode, setServerWantsCode] = useState(false);
  const showCode = serverWantsCode || needsSignupCode(email);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError({
        code: "password_too_short",
        message: `Password needs at least ${MIN_PASSWORD_LENGTH} characters. Pick something long.`,
      });
      return;
    }
    setSubmitting(true);
    const result = await apiPost("/auth/signup", {
      email,
      password,
      displayName,
      ...(showCode && signupCode.trim() ? { signupCode: signupCode.trim() } : {}),
    });
    setSubmitting(false);
    if (!result.ok) {
      if (result.error?.code === "signup_code_required") setServerWantsCode(true);
      setError(result.error);
      return;
    }
    // Cross-user data leak fix: wipe any localStorage the previous
    // user left on this machine BEFORE handing the new user a session.
    // Without this, the new user inherits the prior user's goals /
    // snapshots / evidence / integrations etc., AND MigrateOnce
    // uploads that stale payload under the new user's account.
    clearAllUserScopedStorage();
    // Push the new user into the session store so AuthGuard /
    // useSession reflect the auth state without a /me round-trip.
    setSession({
      user: result.data?.user ?? null,
      loading: false,
      needsTotp: false,
      error: null,
    });
    onSuccess?.(result.data?.user);
  }

  const errorMessage = error ? humanizeError(error) : null;
  // Say WHICH fields hold the button back — a disabled "Create account"
  // with no reason reads as broken (review-ux-flows R17).
  const missing = [
    !displayName.trim() && "display name",
    !email.trim() && "email",
    !password && "password",
    showCode && !signupCode.trim() && "signup code",
  ].filter(Boolean);
  const canSubmit = !submitting && missing.length === 0;

  return (
    <AuthCard
      title="Create account"
      lead="Map your goals, connect your sources, and build review-ready evidence. Use your eSpace email — we'll send you a link to confirm it."
    >
      <p className="-mt-4 mb-6 text-[12.5px] leading-[1.5] text-muted-fg">
        Next: open the link we email you, set up two-factor authentication,
        and fill in a short profile. That&apos;s it — no waiting for approval.
      </p>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <Field label="Display name">
          <Input
            type="text"
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={submitting}
            autoFocus
            required
            minLength={1}
            maxLength={200}
          />
        </Field>

        <Field label="Email">
          <Input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            required
          />
        </Field>

        <div className={showCode ? "grid grid-cols-2 gap-3" : "flex flex-col"}>
          <Field label="Password" hint={`${MIN_PASSWORD_LENGTH}+ characters`}>
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              required
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={256}
            />
          </Field>
          {showCode ? (
            <Field label="Signup code" hint="Not an eSpace email? Ask your admin">
              <Input
                type="text"
                value={signupCode}
                onChange={(e) => setSignupCode(e.target.value)}
                disabled={submitting}
                required
                minLength={4}
                maxLength={64}
              />
            </Field>
          ) : null}
        </div>

        <AuthError>{errorMessage}</AuthError>

        <Button
          type="submit"
          size="lg"
          disabled={!canSubmit}
          aria-describedby={missing.length > 0 ? "signup-missing" : undefined}
          className="w-full"
        >
          {submitting ? "Creating account…" : "Create account"}
        </Button>
        {missing.length > 0 && !submitting ? (
          <p id="signup-missing" className="-mt-2 text-center text-[12.5px] text-muted-fg">
            Still needed: {listPhrase(missing)}.
          </p>
        ) : null}
      </form>

      <div className="mt-6 text-center text-[13px] text-muted-fg">
        Already have an account?{" "}
        <Link href="/login" className="font-bold text-fg">
          Sign in
        </Link>
      </div>
    </AuthCard>
  );
}

function listPhrase(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function humanizeError(error) {
  if (!error) return null;
  switch (error.code) {
    case "signup_code_required":
      return "This email isn't an eSpace address, so it needs a signup code from your admin.";
    case "invalid_signup_code":
      return "Signup code is invalid or expired. Ask your admin for a current one.";
    case "email_taken":
      return "An account with this email already exists. Try signing in instead.";
    case "rate_limited":
      return "Too many attempts. Wait a few minutes and try again.";
    case "network_error":
      return "Network error. Check your connection and try again.";
    default:
      return error.message || "Something went wrong. Please try again.";
  }
}

"use client";

/**
 * Self-serve signup form.
 *
 *   email + password + display name + org signup code
 *     → POST /api/v1/auth/signup
 *     → server creates user with status="pending_admin", mints session
 *     → useSession() refresh picks up the new user
 *     → AuthGuard routes them through /totp-setup → /onboarding →
 *       /waiting-approval
 *
 * The signup code is the abuse-control gate. Admins distribute it
 * over secure channels — Slack/DM, not a public URL. The code lookup
 * is a single Mongo round-trip on the org doc.
 */

import { useState } from "react";
import Link from "next/link";
import { apiPost } from "@/lib/api-client";
import { Button, Field, Input } from "@/components/ui";
import { AuthCard, AuthError } from "./auth-card.jsx";
import { setSession } from "./session-store.js";
import { clearAllUserScopedStorage } from "./clear-user-storage.js";

// Matches accept-invite / password-reset and the API's newPassword rule.
const MIN_PASSWORD_LENGTH = 12;

export function SignupForm({ onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [signupCode, setSignupCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

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
      signupCode: signupCode.trim(),
    });
    setSubmitting(false);
    if (!result.ok) {
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
    !signupCode.trim() && "signup code",
  ].filter(Boolean);
  const canSubmit = !submitting && missing.length === 0;

  return (
    <AuthCard
      title="Create account"
      lead="Map your goals, connect your sources, and build review-ready evidence. You'll need a signup code from your admin."
    >
      <p className="-mt-4 mb-6 text-[12.5px] leading-[1.5] text-muted-fg">
        Next: set up two-factor authentication, fill in a short profile, then
        an admin approves your account and picks your hub.
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

        <div className="grid grid-cols-2 gap-3">
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
          <Field label="Signup code">
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

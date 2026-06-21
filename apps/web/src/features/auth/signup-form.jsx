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
import { setSession } from "./session-store.js";
import { clearAllUserScopedStorage } from "./clear-user-storage.js";

const INPUT_STYLE = {
  fontFamily: "var(--font-mono)",
  fontSize: 13,
  padding: "10px 14px",
  background: "var(--card)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-sub, 3px)",
  outline: "none",
};

const LABEL_STYLE = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: "0.5px",
  color: "var(--muted-fg)",
  textTransform: "uppercase",
};

export function SignupForm({ onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [signupCode, setSignupCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
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

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-5 py-12">
      <div>
        <h1
          className="font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 28,
            letterSpacing: "-0.8px",
          }}
        >
          Create account
        </h1>
        <p
          className="mt-1 text-muted-fg"
          style={{ fontSize: 13.5, lineHeight: 1.5 }}
        >
          You'll need a signup code from your admin. After signing up, your
          account waits for admin approval before you can pick a hub.
        </p>
      </div>

      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <label className="flex flex-col gap-1.5">
          <span style={LABEL_STYLE}>Display name</span>
          <input
            type="text"
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={submitting}
            autoFocus
            required
            minLength={1}
            maxLength={200}
            style={INPUT_STYLE}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span style={LABEL_STYLE}>Email</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            required
            style={INPUT_STYLE}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span style={LABEL_STYLE}>Password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            required
            minLength={8}
            maxLength={256}
            style={INPUT_STYLE}
          />
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--muted-fg)",
            }}
          >
            at least 8 characters
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span style={LABEL_STYLE}>Signup code</span>
          <input
            type="text"
            value={signupCode}
            onChange={(e) => setSignupCode(e.target.value)}
            disabled={submitting}
            required
            minLength={4}
            maxLength={64}
            style={{
              ...INPUT_STYLE,
              letterSpacing: "1px",
              textTransform: "uppercase",
            }}
          />
        </label>

        {errorMessage ? (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              color: "var(--bad)",
            }}
          >
            {errorMessage}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={submitting || !email || !password || !displayName || !signupCode}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.5px",
            textTransform: "uppercase",
            background: "var(--accent)",
            color: "var(--accent-on, #fff)",
            border: 0,
            borderRadius: "var(--radius-sub, 3px)",
            padding: "12px 16px",
            cursor: submitting ? "wait" : "pointer",
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>

      <div
        className="text-center"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--muted-fg)",
        }}
      >
        Already have an account?{" "}
        <Link
          href="/login"
          style={{ color: "var(--accent)", textDecoration: "underline" }}
        >
          Sign in
        </Link>
      </div>
    </div>
  );
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

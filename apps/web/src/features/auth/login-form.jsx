"use client";

/**
 * Two-step login form.
 *
 *   Step 1: email + password
 *           → on success, if needsTotp, swap to step 2; else done
 *   Step 2: 6-digit TOTP code
 *           → on success, fully authenticated; consumer redirects
 *
 * Errors:
 *   - Wrong email/password           → "Invalid email or password."
 *   - Wrong TOTP code                → "Code did not match."
 *   - Network error                  → generic copy with retry
 *
 * No password manager hints — the form is deliberately simple
 * (single `autocomplete="email" / autocomplete="current-password"`)
 * so credential autofill works without surprises.
 */

import { useState } from "react";
import Link from "next/link";
import { useSession } from "./use-session.js";

export function LoginForm({ onSuccess }) {
  const { user, needsTotp, error, login, verifyTotp, loading } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // If already logged in OR step-2 completed, bubble up.
  if (user) {
    onSuccess?.(user);
    return null;
  }

  async function handlePassword(e) {
    e.preventDefault();
    setSubmitting(true);
    const result = await login({ email, password });
    setSubmitting(false);
    if (result.ok && !result.needsTotp) {
      onSuccess?.();
    }
  }

  async function handleTotp(e) {
    e.preventDefault();
    setSubmitting(true);
    const result = await verifyTotp({ code });
    setSubmitting(false);
    if (result.ok) {
      onSuccess?.();
    } else {
      // Clear the input so the user can re-type the next 30-second code.
      setCode("");
    }
  }

  const errorMessage = error ? humanizeError(error) : null;

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-5 py-12">
      <div>
        <h1
          className="font-semibold"
          style={{
            fontFamily: "var(--font-display, var(--font-inter-tight))",
            fontSize: 28,
            letterSpacing: "-0.8px",
          }}
        >
          Sign in
        </h1>
        <p
          className="mt-1 text-muted-fg"
          style={{ fontSize: 13.5, lineHeight: 1.5 }}
        >
          eSpace Dev Hub — your performance evidence, in one place.
        </p>
      </div>

      {needsTotp ? (
        <form className="flex flex-col gap-3" onSubmit={handleTotp}>
          <label className="flex flex-col gap-1.5">
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.5px",
                color: "var(--muted-fg)",
                textTransform: "uppercase",
              }}
            >
              6-digit code from your authenticator
            </span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoFocus
              disabled={submitting || loading}
              required
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 18,
                letterSpacing: "8px",
                padding: "10px 14px",
                textAlign: "center",
                background: "var(--card)",
                border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-sub, 3px)",
                outline: "none",
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
            disabled={code.length !== 6 || submitting || loading}
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
              opacity: code.length === 6 && !submitting ? 1 : 0.6,
            }}
          >
            {submitting ? "Verifying…" : "Verify code"}
          </button>
        </form>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={handlePassword}>
          <label className="flex flex-col gap-1.5">
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.5px",
                color: "var(--muted-fg)",
                textTransform: "uppercase",
              }}
            >
              Email
            </span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting || loading}
              autoFocus
              required
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                padding: "10px 14px",
                background: "var(--card)",
                border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-sub, 3px)",
                outline: "none",
              }}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.5px",
                color: "var(--muted-fg)",
                textTransform: "uppercase",
              }}
            >
              Password
            </span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting || loading}
              required
              minLength={8}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                padding: "10px 14px",
                background: "var(--card)",
                border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-sub, 3px)",
                outline: "none",
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
            disabled={submitting || loading}
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
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? "Signing in…" : "Continue"}
          </button>

          {/* Forgot-password link — only on the password step, not the
              TOTP step (a user on step 2 already authenticated and is
              just stuck on the 6-digit code; the right recovery there
              is backup codes, not password reset). */}
          <div
            className="mt-1"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--muted-fg)",
              textAlign: "center",
            }}
          >
            <Link
              href="/forgot-password"
              className="text-accent hover:underline"
              style={{ fontWeight: 600 }}
            >
              Forgot password?
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}

function humanizeError(err) {
  switch (err.code) {
    case "invalid_credentials":
      return "Invalid email or password.";
    case "validation_error":
      return "Please check the form — some fields look invalid.";
    case "invalid_totp_code":
      return "Code did not match. Try the next one your app generates.";
    case "network_error":
      return "Couldn't reach the server. Check your connection and retry.";
    case "totp_required":
      // The form swapped to step 2; this shouldn't surface.
      return null;
    default:
      return err.message || "Something went wrong. Try again.";
  }
}

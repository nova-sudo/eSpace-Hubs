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
import { Button, Field, Input } from "@/components/ui";
import { AuthCard, AuthError } from "./auth-card.jsx";
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

  if (needsTotp) {
    return (
      <AuthCard
        title="Enter your code"
        lead="6-digit code from your authenticator app."
      >
        <form className="flex flex-col gap-4" onSubmit={handleTotp}>
          <Field label="Authentication code">
            <Input
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
              className="text-center font-mono text-[22px] tracking-[0.3em]"
            />
          </Field>
          <AuthError>{errorMessage}</AuthError>
          <Button
            type="submit"
            size="lg"
            disabled={code.length !== 6 || submitting || loading}
            className="w-full"
          >
            {submitting ? "Verifying…" : "Verify code"}
          </Button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Sign in"
      lead="eSpace Dev Hub — your performance evidence, in one place."
    >
      <form className="flex flex-col gap-4" onSubmit={handlePassword}>
        <Field label="Email">
          <Input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting || loading}
            autoFocus
            required
          />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting || loading}
            required
            minLength={8}
          />
        </Field>
        <AuthError>{errorMessage}</AuthError>
        <Button type="submit" size="lg" disabled={submitting || loading} className="w-full">
          {submitting ? "Signing in…" : "Continue"}
        </Button>

        {/* Forgot-password link — only on the password step, not the
            TOTP step (a user on step 2 already authenticated and is
            just stuck on the 6-digit code; the right recovery there
            is backup codes, not password reset). */}
        <div className="mt-1.5 flex flex-col items-center gap-2 text-center text-[13px]">
          <Link href="/forgot-password" className="font-bold text-fg">
            Forgot password?
          </Link>
          <div className="text-muted-fg">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="font-bold text-fg">
              Create one
            </Link>
          </div>
        </div>
      </form>
    </AuthCard>
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

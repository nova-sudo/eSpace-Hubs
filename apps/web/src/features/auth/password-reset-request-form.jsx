"use client";

/**
 * Password-reset *request* form. Mounted at /forgot-password.
 *
 * Takes an email, POSTs to /api/v1/auth/password/reset-request, which:
 *   - always returns { ok: true } (tells an attacker nothing about
 *     which emails are registered — enumeration defense)
 *   - if the address resolves to an active, password-set user, mints
 *     a single-use reset token + emails the link
 *
 * Because the server intentionally hides "no such user" from the
 * caller, this form's success state is identical for valid and
 * invalid inputs: "if an account exists, an email is on its way."
 * Anything more specific would leak account existence.
 *
 * Rate-limited server-side at the per-IP layer
 * (`passwordResetRequestLimiter`); the form additionally disables the
 * submit button while in flight to prevent accidental double-fires.
 */

import { useState } from "react";
import Link from "next/link";
import { apiPost } from "@/lib/api-client";
import { Button, Field, Input } from "@/components/ui";
import { AuthCard, AuthError } from "./auth-card.jsx";

export function PasswordResetRequestForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const r = await apiPost("/auth/password/reset-request", { email });
    setSubmitting(false);
    if (!r.ok) {
      // Reset-request is enumeration-safe on the happy path — the
      // only errors that reach the client are rate-limit / validation
      // / network. Surface them; don't swallow.
      setError(humanise(r.error));
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <AuthCard title="Check your inbox">
        <p className="mb-4 text-[13.5px] leading-[1.5] text-muted-fg">
          If <span className="font-bold text-fg">{email}</span> is registered,
          we&apos;ve sent you a reset link. Open the link from the same
          browser you signed in with. The link expires soon — request a
          fresh one if it&apos;s already gone stale.
        </p>
        <div className="text-[13px] text-muted-fg">
          Didn&apos;t get it? Double-check the address, then{" "}
          <Link href="/login" className="font-bold text-fg">
            back to sign-in
          </Link>{" "}
          and try again.
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset password"
      lead="Enter the email tied to your account. If we recognise it, you'll get a link to set a new password."
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <Field label="Email">
          <Input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            autoFocus
            required
          />
        </Field>

        <AuthError>{error}</AuthError>

        <Button type="submit" size="lg" disabled={!email || submitting} className="w-full">
          {submitting ? "Sending…" : "Send reset link"}
        </Button>
      </form>

      <div className="mt-6 text-center text-[13px] text-muted-fg">
        Remembered it?{" "}
        <Link href="/login" className="font-bold text-fg">
          Back to sign-in
        </Link>
      </div>
    </AuthCard>
  );
}

function humanise(err) {
  if (!err) return "Something went wrong. Try again.";
  if (err.code === "rate_limited")
    return "Too many requests from this network. Wait a few minutes and try again.";
  if (err.code === "validation_error")
    return err.message || "That doesn't look like a valid email.";
  if (err.code === "network_error")
    return "Couldn't reach the server. Check your connection and try again.";
  return err.message || "Something went wrong. Try again.";
}

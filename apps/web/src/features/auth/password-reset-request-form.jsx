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
      <SuccessPanel email={email} />
    );
  }

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
          Reset your password
        </h1>
        <p
          className="mt-1 text-muted-fg"
          style={{ fontSize: 13.5, lineHeight: 1.5 }}
        >
          Enter the email tied to your account. If we recognise it,
          you&apos;ll get a link to set a new password.
        </p>
      </div>

      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
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
            disabled={submitting}
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

        {error ? (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              color: "var(--bad)",
            }}
          >
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={!email || submitting}
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
            opacity: email && !submitting ? 1 : 0.6,
          }}
        >
          {submitting ? "Sending…" : "Send reset link"}
        </button>
      </form>

      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--muted-fg)",
        }}
      >
        Remembered it?{" "}
        <Link
          href="/login"
          className="text-accent hover:underline"
          style={{ fontWeight: 600 }}
        >
          Back to sign-in
        </Link>
      </div>
    </div>
  );
}

function SuccessPanel({ email }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4 py-12">
      <h1
        className="font-semibold"
        style={{
          fontFamily: "var(--font-display, var(--font-inter-tight))",
          fontSize: 26,
          letterSpacing: "-0.7px",
        }}
      >
        Check your inbox.
      </h1>
      <p
        className="text-muted-fg"
        style={{ fontSize: 13.5, lineHeight: 1.55 }}
      >
        If <span style={{ color: "var(--fg)" }}>{email}</span> is
        registered, we&apos;ve sent you a reset link. Open the link
        from the same browser you signed in with. The link expires
        soon — request a fresh one if it&apos;s already gone stale.
      </p>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--muted-fg)",
        }}
      >
        Didn&apos;t get it? Double-check the address, then{" "}
        <Link
          href="/login"
          className="text-accent hover:underline"
          style={{ fontWeight: 600 }}
        >
          back to sign-in
        </Link>{" "}
        and try again.
      </div>
    </div>
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

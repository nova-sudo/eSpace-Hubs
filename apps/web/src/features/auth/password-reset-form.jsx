"use client";

/**
 * Password-reset *redemption* form. Mounted at /password-reset?token=…
 *
 * Reads the single-use token from the URL, captures a new password +
 * confirmation, POSTs to /api/v1/auth/password/reset. The server:
 *   1. Redeems the token (one-shot — same token can't be reused).
 *   2. argon2id-hashes the new password.
 *   3. Force-logs out every existing session for this user (so a
 *      compromised session can't ride the change).
 *   4. Deletes any other pending reset/invite tokens for this user.
 *
 * Notably: the server does NOT mint a new session on reset. The
 * legitimate user lands at /login after the success state, types
 * their new password, and gets routed into the app normally — same
 * flow they'd hit if they'd remembered the old password.
 *
 * Mirrors the AcceptInviteForm shape (password + confirm, MIN_LENGTH
 * guard, humanised errors) so users who hit either flow see a
 * consistent surface.
 *
 * Errors surfaced from the API:
 *   invalid_token   → "Reset link is invalid or expired."
 *   validation_*    → field-level message
 *   rate_limited    → "Too many attempts on this network…"
 *   network_error   → generic "couldn't reach the server"
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiPost } from "@/lib/api-client";

const MIN_PASSWORD_LENGTH = 12;

export function PasswordResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  if (!token) {
    return (
      <ErrorPanel
        title="Missing reset token."
        body="Your reset link is incomplete. Open it again from the email you received, or request a new link."
      />
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(
        `Password needs at least ${MIN_PASSWORD_LENGTH} characters. Pick something long.`,
      );
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    const r = await apiPost("/auth/password/reset", { token, password });
    setSubmitting(false);
    if (!r.ok) {
      setError(humanise(r.error));
      return;
    }
    setDone(true);
    // Give the user a beat to read the success copy, then redirect
    // to /login. They'll sign in with the password they just set.
    setTimeout(() => router.replace("/login"), 1800);
  }

  if (done) {
    return <SuccessPanel />;
  }

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
          Set a new password
        </h1>
        <p
          className="mt-1 text-muted-fg"
          style={{ fontSize: 13.5, lineHeight: 1.5 }}
        >
          Pick something long. You&apos;ll be signed in fresh after
          you set it.
        </p>
      </div>

      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <PasswordField
          label="New password"
          value={password}
          onChange={setPassword}
          autoFocus
          autoComplete="new-password"
          disabled={submitting}
        />
        <PasswordField
          label="Confirm new password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          disabled={submitting}
        />
        <p
          className="text-muted-fg"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            letterSpacing: "0.3px",
          }}
        >
          {MIN_PASSWORD_LENGTH}+ characters · stored as an argon2id hash
        </p>

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
          disabled={!password || !confirm || submitting}
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
            opacity: password && confirm && !submitting ? 1 : 0.6,
          }}
        >
          {submitting ? "Updating…" : "Set new password"}
        </button>
      </form>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoFocus,
  autoComplete,
  disabled,
}) {
  return (
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
        {label}
      </span>
      <input
        type="password"
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required
        autoFocus={autoFocus}
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
  );
}

function SuccessPanel() {
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4 py-12">
      <h1
        className="font-semibold"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 26,
          letterSpacing: "-0.7px",
        }}
      >
        Password updated.
      </h1>
      <p
        className="text-muted-fg"
        style={{ fontSize: 13.5, lineHeight: 1.55 }}
      >
        Redirecting you to sign-in. Use your new password to continue.
      </p>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--muted-fg)",
        }}
      >
        Not redirected?{" "}
        <Link
          href="/login"
          className="text-accent hover:underline"
          style={{ fontWeight: 600 }}
        >
          Go to sign-in
        </Link>
      </div>
    </div>
  );
}

function ErrorPanel({ title, body }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-3 py-12">
      <h1
        className="font-semibold"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 24,
          letterSpacing: "-0.6px",
        }}
      >
        {title}
      </h1>
      <p
        className="text-muted-fg"
        style={{ fontSize: 13.5, lineHeight: 1.5 }}
      >
        {body}
      </p>
      <div
        className="mt-1"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--muted-fg)",
        }}
      >
        <Link
          href="/forgot-password"
          className="text-accent hover:underline"
          style={{ fontWeight: 600 }}
        >
          Request a new link
        </Link>
      </div>
    </div>
  );
}

function humanise(err) {
  if (!err) return "Something went wrong. Try again.";
  if (err.code === "invalid_token")
    return "Reset link is invalid or expired. Request a fresh one.";
  if (err.code === "rate_limited")
    return "Too many attempts on this network. Wait a few minutes and try again.";
  if (err.code === "validation_error")
    return err.message || "Check the fields and try again.";
  if (err.code === "network_error")
    return "Couldn't reach the server. Check your connection and try again.";
  return err.message || "Something went wrong. Try again.";
}

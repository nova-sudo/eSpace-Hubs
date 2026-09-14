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
import { Button, Field, Input } from "@/components/ui";
import { AuthCard, AuthError } from "./auth-card.jsx";

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
      <AuthCard title="Missing reset token">
        <p className="mb-5 text-[13.5px] leading-[1.5] text-muted-fg">
          Your reset link is incomplete. Open it again from the email you
          received, or request a new link.
        </p>
        <Link href="/forgot-password" className="text-[13px] font-bold text-fg">
          Request a new link
        </Link>
      </AuthCard>
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
    return (
      <AuthCard
        title="Password updated"
        lead="Redirecting you to sign-in. Use your new password to continue."
      >
        <div className="text-[13px] text-muted-fg">
          Not redirected?{" "}
          <Link href="/login" className="font-bold text-fg">
            Go to sign-in
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="New password"
      lead="Choose a new password. You'll be signed in on this device once it's set."
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <Field label="New password">
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            required
            autoFocus
          />
        </Field>
        <Field
          label="Confirm password"
          hint={`${MIN_PASSWORD_LENGTH}+ characters · argon2id hash`}
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={submitting}
            required
          />
        </Field>

        <AuthError>{error}</AuthError>

        <Button
          type="submit"
          size="lg"
          disabled={!password || !confirm || submitting}
          className="w-full"
        >
          {submitting ? "Updating…" : "Update password"}
        </Button>
      </form>
    </AuthCard>
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

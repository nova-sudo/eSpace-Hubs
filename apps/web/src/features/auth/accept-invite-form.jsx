"use client";

/**
 * Invite-redemption form. Mounted at /accept-invite.
 *
 * Reads the token from the URL, captures a password + confirmation,
 * POSTs to /api/v1/auth/accept-invite. The server:
 *   1. Redeems the single-use token.
 *   2. argon2id-hashes the password + flips status to "active".
 *   3. Mints a session cookie (totpVerified: true) so the user lands
 *      logged-in without bouncing through /login again.
 *
 * Post-accept the AuthGuard sees `onboardingCompletedAt: null` and
 * routes the user to /onboarding for the M-OB 3-field form.
 *
 * Errors surfaced from the API:
 *   invalid_token   → "Invite link is invalid or expired."
 *   validation_*    → field-level message
 *   network_error   → generic "couldn't reach the server"
 */

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiPost } from "@/lib/api-client";
import { Button, Field, Input } from "@/components/ui";
import { AuthCard, AuthError } from "./auth-card.jsx";
import { useSession } from "./use-session.js";
import { clearAllUserScopedStorage } from "./clear-user-storage.js";

const MIN_PASSWORD_LENGTH = 12;

export function AcceptInviteForm({ onSuccess }) {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useSession();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!token) {
    return (
      <AuthCard title="Missing invite token">
        <p className="text-[13.5px] leading-[1.5] text-muted-fg">
          Your invite link is incomplete. Open it again from the email you
          received, or ask whoever invited you to resend.
        </p>
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
    const r = await apiPost("/auth/accept-invite", { token, password });
    setSubmitting(false);
    if (!r.ok) {
      setError(humanise(r.error));
      return;
    }

    // Cookie's already set by the API. Wipe any localStorage left by
    // a prior user on this browser (cross-user data leak fix) BEFORE
    // refreshing the session — `refresh()` flips `user` and the
    // *Sync effects mount; if localStorage still has the prior user's
    // data they'd race / upload it via MigrateOnce.
    clearAllUserScopedStorage();
    // Refresh the session store so useSession() sees the new user,
    // then bubble up.
    await refresh();
    onSuccess?.(r.data?.user);
    // Default destination: /onboarding. AuthGuard would route here
    // anyway since `onboardingCompletedAt` is null on the fresh user,
    // but doing it explicitly avoids one navigation tick.
    router.replace("/onboarding");
  }

  return (
    <AuthCard
      title="Activate account"
      lead="Pick a password. We'll set up your profile in the next step."
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <Field label="Password">
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
          hint={`${MIN_PASSWORD_LENGTH}+ characters · stored as an argon2id hash`}
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
          {submitting ? "Activating…" : "Activate account"}
        </Button>
      </form>
    </AuthCard>
  );
}

function humanise(err) {
  if (!err) return "Something went wrong. Try again.";
  if (err.code === "invalid_token")
    return "Invite link is invalid or expired. Ask for a new invite.";
  if (err.code === "validation_error")
    return err.message || "Check the fields and try again.";
  if (err.code === "network_error")
    return "Couldn't reach the server. Check your connection and try again.";
  return err.message || "Something went wrong. Try again.";
}

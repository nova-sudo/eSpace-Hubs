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
      <ErrorPanel
        title="Missing invite token."
        body="Your invite link is incomplete. Open it again from the email you received, or ask whoever invited you to resend."
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
          Activate your account
        </h1>
        <p
          className="mt-1 text-muted-fg"
          style={{ fontSize: 13.5, lineHeight: 1.5 }}
        >
          Pick a password. We'll set up your profile in the next step.
        </p>
      </div>

      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          autoFocus
          autoComplete="new-password"
          disabled={submitting}
        />
        <PasswordField
          label="Confirm password"
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
          {submitting ? "Activating…" : "Activate account"}
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
    </div>
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

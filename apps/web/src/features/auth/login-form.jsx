"use client";

/**
 * Two-step login form.
 *
 *   Step 1: email + password
 *           → on success, if needsTotp, swap to step 2; else done
 *   Step 2: 6-digit TOTP code — or, via "Use a backup code instead",
 *           a single-use `xxxx-xxxx` backup code
 *           → on success, fully authenticated; consumer redirects
 *
 * Errors:
 *   - Wrong email/password           → "Invalid email or password."
 *   - Wrong TOTP code                → "Code did not match."
 *   - Wrong / spent backup code      → "That backup code didn't work…"
 *   - Network error                  → generic copy with retry
 *
 * No password manager hints — the form is deliberately simple
 * (single `autocomplete="email" / autocomplete="current-password"`)
 * so credential autofill works without surprises.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button, Field, Input } from "@/components/ui";
import { AuthCard, AuthError } from "./auth-card.jsx";
import { useSession } from "./use-session.js";
import { markBackupCodeLogin, moveTwoFactorHref } from "./backup-login-marker.js";

export function LoginForm({ onSuccess, expired = false }) {
  const { user, needsTotp, error, login, verifyTotp, logout, loading } =
    useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [backupMode, setBackupMode] = useState(false);
  const [backupCode, setBackupCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // If already logged in OR step-2 completed, bubble up — from an effect,
  // not during render (the parent navigates, which updates the Router).
  // This is the ONE place onSuccess fires: login / verifyTotp promote the
  // user into the session store, which lands here. The submit handlers
  // used to call it too, so every sign-in navigated twice.
  useEffect(() => {
    if (user) onSuccess?.(user);
    // onSuccess identity changes every parent render; only react to `user`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);
  if (user) return null;

  async function handlePassword(e) {
    e.preventDefault();
    setSubmitting(true);
    await login({ email, password });
    setSubmitting(false);
  }

  async function handleTotp(e) {
    e.preventDefault();
    setSubmitting(true);
    const result = backupMode
      ? await verifyTotp({ backupCode: backupCode.trim() })
      : await verifyTotp({ code });
    setSubmitting(false);
    if (result.ok) {
      if (result.usedBackupCode) {
        markBackupCodeLogin();
        announceBackupCodeUsed(result.backupCodesRemaining, result.user?.primaryHub);
      } else if (result.backupCodesRemaining === 0) {
        // Enrolled before backup codes existed (or used them all up).
        toast.warning("You have no backup codes", {
          description:
            "If you lose your phone they're the only way in without an admin. Generate them in Settings → Account.",
          duration: 10000,
        });
      }
    } else if (backupMode) {
      // Keep a mistyped backup code so the user can fix one character.
    } else {
      // Clear the input so the user can re-type the next 30-second code.
      setCode("");
    }
  }

  function toggleBackupMode() {
    setBackupMode((on) => !on);
    setCode("");
    setBackupCode("");
  }

  const backupReady = normaliseBackupInput(backupCode).length === 8;

  const errorMessage = error ? humanizeError(error) : null;
  // A session-expiry bounce (`/login?reason=expired`) reads as a notice,
  // not a failure — it clears the moment a real auth error arrives.
  const notice = !errorMessage && expired ? "Your session expired — sign in to continue." : null;

  if (needsTotp) {
    return (
      <AuthCard
        title={backupMode ? "Enter a backup code" : "Enter your code"}
        lead={
          backupMode
            ? "One of the backup codes you saved when you set up two-factor. Each works once."
            : "6-digit code from your authenticator app."
        }
      >
        <form className="flex flex-col gap-4" onSubmit={handleTotp}>
          {backupMode ? (
            <Field label="Backup code">
              <Input
                key="backup"
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="xxxx-xxxx"
                maxLength={16}
                value={backupCode}
                onChange={(e) => setBackupCode(e.target.value)}
                autoFocus
                disabled={submitting || loading}
                required
                className="text-center font-mono text-[20px] tracking-[0.12em]"
              />
            </Field>
          ) : (
            <Field label="Authentication code">
              <Input
                key="totp"
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
          )}
          <AuthError>{errorMessage}</AuthError>
          <Button
            type="submit"
            size="lg"
            disabled={
              (backupMode ? !backupReady : code.length !== 6) || submitting || loading
            }
            className="w-full"
          >
            {submitting ? "Verifying…" : backupMode ? "Use backup code" : "Verify code"}
          </Button>

          {/* Recovery + escape hatch for step 2. Backup codes first; an
              admin reset is the last resort. A user who picked the wrong
              account needs a way back to step 1 without hunting for a
              sign-out button. */}
          <div className="mt-1.5 flex flex-col items-center gap-2 text-center text-[13px] text-muted-fg">
            <button
              type="button"
              onClick={toggleBackupMode}
              disabled={submitting}
              className="font-bold text-fg hover:underline"
            >
              {backupMode ? "Use your authenticator app instead" : "Use a backup code instead"}
            </button>
            <div>
              Lost your phone? Sign in with one of your backup codes, then
              use &ldquo;Move to a new phone&rdquo; in Settings → Account.
              Only if you have neither the phone nor a backup code does an
              admin need to reset two-factor for you.
            </div>
            <button
              type="button"
              onClick={() => {
                // Back to step 1 in the default mode — the next account's
                // step 2 must not open in backup-code mode.
                setCode("");
                setBackupCode("");
                setBackupMode(false);
                void logout();
              }}
              disabled={submitting}
              className="font-bold text-fg hover:underline"
            >
              Use a different account
            </button>
          </div>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Sign in"
      lead="eSpace Hubs — your performance evidence, in one place."
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
        {notice ? (
          <p role="status" className="rounded-[var(--radius-lg)] bg-lemon px-3.5 py-2.5 text-[13px] font-semibold text-lemon-ink">
            {notice}
          </p>
        ) : null}
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
    case "invalid_backup_code":
      return "That backup code didn't work — it may be mistyped or already used.";
    case "network_error":
      return "Couldn't reach the server. Check your connection and retry.";
    case "totp_required":
      // The form swapped to step 2; this shouldn't surface.
      return null;
    default:
      return err.message || "Something went wrong. Try again.";
  }
}

/** Same folding the server does — for enabling the submit button only. */
function normaliseBackupInput(v) {
  return String(v || "").toLowerCase().replace(/[\s-]/g, "");
}

/**
 * After a backup-code sign-in the likely story is a lost or replaced
 * phone — offer to move two-factor right away. The toast outlives the
 * post-login redirect (the <Toaster> is in the root layout), so the
 * hub is read from the URL at CLICK time, by when the user has landed
 * in /<hub>/…; the profile's home hub is the fallback.
 */
function announceBackupCodeUsed(remaining, primaryHub) {
  const counted = typeof remaining === "number";
  const title = counted ? `Backup code used — ${remaining} left` : "Backup code used";
  const description =
    "Lost or replaced your phone? Set up the new one now — it takes a minute and gives you a fresh set of backup codes." +
    (counted && remaining === 0 ? " You're out of backup codes." : "");
  const show = counted && remaining <= 2 ? toast.warning : toast.message;
  show(title, {
    description,
    duration: 30000,
    action: {
      label: "Set up your new phone now",
      onClick: () => {
        if (typeof window === "undefined") return;
        const seg = window.location.pathname.split("/")[1];
        const hub = seg && seg !== "login" ? seg : primaryHub;
        if (!hub) {
          toast.error("Open Settings → Account and choose “Move to a new phone”.");
          return;
        }
        window.location.assign(moveTwoFactorHref(hub));
      },
    },
  });
}

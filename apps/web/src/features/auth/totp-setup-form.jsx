"use client";

/**
 * TOTP enrolment form. Mounted at /totp-setup.
 *
 * Three-step ceremony:
 *   1. On mount, POST /api/v1/auth/totp/enrol — server generates a
 *      fresh base32 secret, encrypts + persists it as PENDING
 *      (totpSecret set, totpEnrolledAt still null), and returns
 *      { secret, otpauthUrl }.
 *   2. The user scans the QR into their authenticator OR manually
 *      types the secret. They submit the 6-digit code their app
 *      generates. We POST /api/v1/auth/totp/verify-enrolment.
 *      Server confirms the code matches and sets totpEnrolledAt.
 *   3. A "save your backup codes" screen. verify-enrolment returns 10
 *      single-use backup codes exactly once (the server keeps only
 *      hashes) — we hold the user here until they press Continue, and
 *      only then refresh the session (which flips `user.totpEnrolled`
 *      and lets AuthGuard route them onward). The secret is repeated
 *      there too, as the secondary way to re-add the account.
 *
 * Why enrolment happens after the first login + before onboarding:
 * a fresh user lands here with `totpVerified: true` (the session was
 * minted that way because they had no TOTP at login), but the
 * AuthGuard refuses to let them past until totpEnrolled flips true.
 * Doing this BEFORE the onboarding profile fields means we
 * establish 2FA before they hand over any PII.
 *
 * QR rendering (TotpSecretPanel) uses the `qrcode` package client-side. The
 * provisioning URL contains the user's email + the raw secret —
 * it MUST NOT be sent to a third-party QR API (e.g. Google Charts).
 * Local-only rendering keeps the secret inside the browser.
 *
 * Errors surfaced from the API:
 *   totp_already_enrolled   → refresh the session; AuthGuard moves on
 *   invalid_state           → "Enrolment expired — start over"
 *   invalid_totp_code       → "Code did not match. Try the next one."
 *   network_error           → generic retry copy
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { Button, Card, Field, Input, Label, Loading } from "@/components/ui";
import { AuthCard, AuthError } from "./auth-card.jsx";
import { BackupCodesPanel } from "./backup-codes-panel.jsx";
import { TotpSecretPanel, formatTotpSecret } from "./totp-secret-panel.jsx";
import { useSession } from "./use-session.js";

const PHASE_LOADING = "loading";
const PHASE_ENROL_FAILED = "enrol_failed";
const PHASE_SHOW_SECRET = "show_secret";
const PHASE_DONE = "done";

export function TotpSetupForm() {
  const router = useRouter();
  const { user, refreshSilent, logout } = useSession();
  const [phase, setPhase] = useState(PHASE_LOADING);
  const [secret, setSecret] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [enrolAttempt, setEnrolAttempt] = useState(0);

  // Kick off enrolment on mount and again on every Retry. Strict-mode
  // double-fires the effect in dev — the second /enrol overwrites the
  // first pending secret, which is harmless (the UI shows the latest).
  useEffect(() => {
    let cancelled = false;
    setPhase(PHASE_LOADING);
    setError(null);
    (async () => {
      const r = await apiPost("/auth/totp/enrol", {});
      if (cancelled) return;
      if (!r.ok) {
        if (r.error?.code === "totp_already_enrolled") {
          // Stale session state — the server says we're enrolled. Pull
          // fresh /me; AuthGuard then routes away from this page.
          void refreshSilent();
          return;
        }
        setError(humanise(r.error));
        setPhase(PHASE_ENROL_FAILED);
        return;
      }
      setSecret(r.data?.secret ?? "");
      setOtpauthUrl(r.data?.otpauthUrl ?? "");
      setPhase(PHASE_SHOW_SECRET);
    })();
    return () => {
      cancelled = true;
    };
  }, [enrolAttempt, refreshSilent]);

  async function handleVerify(e) {
    e.preventDefault();
    setError(null);
    if (code.length !== 6) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setSubmitting(true);
    const r = await apiPost("/auth/totp/verify-enrolment", { code });
    setSubmitting(false);
    if (!r.ok) {
      if (r.error?.code === "invalid_state") {
        // Pending secret expired server-side — the only fix is a fresh
        // enrol. Restart instead of leaving the user on a dead form.
        setEnrolAttempt((n) => n + 1);
        setCode("");
        toast.error("Enrolment expired — here's a fresh secret.");
        return;
      }
      setError(humanise(r.error));
      setCode("");
      return;
    }
    // Deliberately NOT refreshing the session yet: the moment
    // `user.totpEnrolled` flips, AuthGuard routes away from this page,
    // and the user needs one screen to save their backup codes first.
    setBackupCodes(Array.isArray(r.data?.backupCodes) ? r.data.backupCodes : []);
    setPhase(PHASE_DONE);
    toast.success("Two-factor enabled.");
  }

  const handleContinue = useCallback(async () => {
    setSubmitting(true);
    await refreshSilent();
    router.replace("/");
  }, [refreshSilent, router]);

  const title =
    phase === PHASE_DONE
      ? "Two-factor is on"
      : phase === PHASE_ENROL_FAILED
        ? "Couldn't start two-factor"
        : "Two-factor";
  const lead =
    phase === PHASE_DONE
      ? "Your account now asks for a 6-digit code at every sign-in. Save your backup codes before you continue."
      : phase === PHASE_ENROL_FAILED
        ? "We couldn't generate a secret for your authenticator app."
        : "Scan the QR with your authenticator app, then enter the 6-digit code it generates.";

  return (
    <AuthCard
      title={title}
      lead={lead}
      footer={<SignedInFooter email={user?.email} onSignOut={logout} />}
    >
      {phase === PHASE_LOADING ? (
        <Loading label="Generating your secret…" />
      ) : phase === PHASE_ENROL_FAILED ? (
        <div className="flex flex-col gap-4">
          <AuthError>{error}</AuthError>
          <Button
            size="lg"
            className="w-full"
            onClick={() => setEnrolAttempt((n) => n + 1)}
          >
            Try again
          </Button>
        </div>
      ) : phase === PHASE_DONE ? (
        <DonePanel
          secret={secret}
          backupCodes={backupCodes}
          email={user?.email}
          submitting={submitting}
          onContinue={handleContinue}
        />
      ) : (
        <>
          <TotpSecretPanel otpauthUrl={otpauthUrl} secret={secret} />

          <form onSubmit={handleVerify} className="flex flex-col gap-4">
            <Field label="Code from your app">
              <Input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                disabled={submitting}
                autoFocus
                required
                className="text-center font-mono text-[22px] tracking-[0.3em]"
              />
            </Field>

            <AuthError>{error}</AuthError>

            <Button
              type="submit"
              size="lg"
              disabled={code.length !== 6 || submitting}
              className="w-full"
            >
              {submitting ? "Verifying…" : "Verify & enable"}
            </Button>
          </form>
        </>
      )}
    </AuthCard>
  );
}

/**
 * Post-enrolment hold screen. The backup codes are shown exactly once
 * (the server stores only hashes), so the user stays here until they
 * say they've saved them. The raw secret sits underneath as the
 * secondary recovery path — it re-adds the account to a new app.
 */
function DonePanel({ secret, backupCodes, email, submitting, onContinue }) {
  const formatted = useMemo(() => formatTotpSecret(secret), [secret]);
  const hasCodes = backupCodes.length > 0;
  return (
    <div className="flex flex-col gap-4">
      {hasCodes ? (
        <Card tone="lemon" radius="lg" padding={14} className="text-[13px] leading-[1.55]">
          <div className="font-bold">Save your backup codes</div>
          <p className="mt-1">
            Lost your phone? Each code signs you in once instead of the
            6-digit code. This is the only time they&apos;re shown — copy or
            download them now and keep them somewhere safe.
          </p>
        </Card>
      ) : null}
      {hasCodes ? <BackupCodesPanel codes={backupCodes} email={email} /> : null}
      <div className="rounded-[var(--radius-lg)] bg-card-alt p-3.5 text-[12.5px] leading-[1.5] text-muted-fg">
        <Label>Authenticator secret</Label>
        <code className="mt-1 block break-all font-mono text-[12px] leading-[1.5] text-fg">
          {formatted}
        </code>
        <p className="mt-1.5">
          Re-adds eSpace Hubs to a new authenticator app. If you lose both
          this and your backup codes, your admin has to reset two-factor
          before you can sign in again.
        </p>
      </div>
      <Button size="lg" className="w-full" onClick={onContinue} disabled={submitting}>
        {submitting ? "Continuing…" : hasCodes ? "I've saved these — continue" : "I've saved it — continue"}
      </Button>
    </div>
  );
}

function SignedInFooter({ email, onSignOut }) {
  return (
    <div className="text-center text-[12.5px] text-muted-fg">
      Signed in as {email || "—"} ·{" "}
      <button
        type="button"
        onClick={() => onSignOut()}
        className="font-bold text-fg hover:underline"
      >
        Sign out
      </button>
    </div>
  );
}

function humanise(err) {
  if (!err) return "Something went wrong. Try again.";
  if (err.code === "totp_already_enrolled")
    return "Two-factor is already set up on this account. Taking you to the app…";
  if (err.code === "invalid_state")
    return "Enrolment session expired. Try again to get a fresh secret.";
  if (err.code === "invalid_totp_code")
    return "Code did not match. Try the next one your app generates.";
  if (err.code === "totp_secret_corrupted")
    return "The stored secret couldn't be read. Try again to start over.";
  if (err.code === "rate_limited")
    return "Too many attempts. Wait a moment and try again.";
  if (err.code === "validation_error")
    return err.message || "Code must be 6 digits.";
  if (err.code === "network_error")
    return "Couldn't reach the server. Check your connection and retry.";
  return err.message || "Something went wrong. Try again.";
}

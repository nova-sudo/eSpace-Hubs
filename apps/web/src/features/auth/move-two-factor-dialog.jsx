"use client";

/**
 * "Move to a new phone" — self-service two-factor re-enrolment, from
 * Settings → Account. No admin needed.
 *
 *   1. Prove it's you: password + a code from the OLD authenticator, or
 *      one of the backup codes (spent). If this tab signed in with a
 *      backup code in the last few minutes, the password alone is
 *      enough — the server checks the session stamp.
 *      → POST /auth/totp/re-enrol/start → { secret, otpauthUrl }
 *   2. Scan the new QR on the new phone, type the code it shows.
 *      → POST /auth/totp/re-enrol/confirm → { backupCodes }
 *   3. Save the new backup codes (the old ones stopped working).
 *
 * Cancelling before step 3 changes nothing: the old phone keeps working
 * and the pending secret expires on the server after 15 minutes.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { X } from "lucide-react";
import { apiPost } from "@/lib/api-client";
import {
  Button,
  Card,
  Field,
  IconButton,
  Input,
  SegmentedControl,
  useFocusTrap,
} from "@/components/ui";
import { AuthError } from "./auth-card.jsx";
import { BackupCodesPanel } from "./backup-codes-panel.jsx";
import { TotpSecretPanel } from "./totp-secret-panel.jsx";
import { hasRecentBackupCodeLogin, clearRecentBackupCodeLogin } from "./backup-login-marker.js";
import { useCodesDialogClose } from "./use-codes-dialog-close.js";

const STEP_VERIFY = "verify";
const STEP_SCAN = "scan";
const STEP_DONE = "done";

const FACTOR_OPTIONS = [
  { value: "code", label: "Authenticator code" },
  { value: "backup", label: "Backup code" },
];

export function MoveTwoFactorDialog({ open, onClose, email, onMoved }) {
  const trapRef = useFocusTrap(open);
  const [step, setStep] = useState(STEP_VERIFY);
  const [password, setPassword] = useState("");
  const [factor, setFactor] = useState("code");
  const [code, setCode] = useState("");
  const [backupCode, setBackupCode] = useState("");
  // Signed in with a backup code moments ago → the password is enough.
  const [shortcut, setShortcut] = useState(false);
  const [secret, setSecret] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [newCode, setNewCode] = useState("");
  const [codes, setCodes] = useState(null);
  const [codesSaved, setCodesSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Escape / backdrop / X go through requestClose: no-op mid-request, and
  // a confirm before dropping backup codes that were never saved.
  const { requestClose, snapshot, isCurrent } = useCodesDialogClose({
    open,
    onClose,
    submitting,
    codesShown: step === STEP_DONE,
    codesSaved,
  });

  // Reset on every open AND close — secrets and codes must not linger in
  // state, and a new opening always starts at step 1.
  useEffect(() => {
    setShortcut(open ? hasRecentBackupCodeLogin() : false);
    setStep(STEP_VERIFY);
    setPassword("");
    setFactor("code");
    setCode("");
    setBackupCode("");
    setSecret("");
    setOtpauthUrl("");
    setNewCode("");
    setCodes(null);
    setCodesSaved(false);
    setError(null);
    setSubmitting(false);
  }, [open]);

  const factorReady = shortcut
    ? true
    : factor === "code"
      ? code.length === 6
      : backupCode.replace(/[\s-]/g, "").length === 8;

  async function handleStart(e) {
    e.preventDefault();
    if (!password || !factorReady) return;
    setError(null);
    setSubmitting(true);
    const body = shortcut
      ? { password }
      : factor === "code"
        ? { password, code }
        : { password, backupCode: backupCode.trim() };
    const snap = snapshot();
    const r = await apiPost("/auth/totp/re-enrol/start", body);
    // Closed (or re-opened) while this was out — never repopulate the dialog.
    if (!isCurrent(snap)) return;
    setSubmitting(false);
    if (!r.ok) {
      if (r.error?.code === "factor_required") {
        // The backup-code sign-in is too old to count — ask for a code.
        setShortcut(false);
        clearRecentBackupCodeLogin();
      }
      if (r.error?.code === "invalid_totp_code") setCode("");
      setError(humanise(r.error));
      return;
    }
    if (body.backupCode) {
      // A code was spent — the Account tab's count should follow.
      onMoved?.();
    }
    setSecret(r.data?.secret ?? "");
    setOtpauthUrl(r.data?.otpauthUrl ?? "");
    setStep(STEP_SCAN);
  }

  async function handleConfirm(e) {
    e.preventDefault();
    if (newCode.length !== 6) return;
    setError(null);
    setSubmitting(true);
    const snap = snapshot();
    const r = await apiPost("/auth/totp/re-enrol/confirm", { code: newCode });
    if (!isCurrent(snap)) return;
    setSubmitting(false);
    if (!r.ok) {
      setNewCode("");
      if (["reenrol_expired", "reenrol_not_started", "reenrol_superseded"].includes(r.error?.code)) {
        // Pending secret is gone — back to step 1 for a fresh one.
        setStep(STEP_VERIFY);
        setCode("");
        setBackupCode("");
        setSecret("");
        setOtpauthUrl("");
      }
      setError(humanise(r.error));
      return;
    }
    clearRecentBackupCodeLogin();
    setCodes(Array.isArray(r.data?.backupCodes) ? r.data.backupCodes : []);
    setStep(STEP_DONE);
    toast.success("Two-factor moved to your new phone.");
    onMoved?.();
  }

  if (!open || typeof document === "undefined") return null;

  const title =
    step === STEP_DONE
      ? "Your new backup codes"
      : step === STEP_SCAN
        ? "Scan with your new phone"
        : "Move to a new phone";

  return createPortal(
    <>
      <div className="fixed inset-0 z-[70] bg-scrim" onClick={requestClose} aria-hidden="true" />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed left-1/2 top-1/2 z-[71] max-h-[calc(100vh-32px)] w-[min(460px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-xl)] bg-card p-6"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[12px] font-semibold text-muted-fg">
              Step {step === STEP_VERIFY ? 1 : step === STEP_SCAN ? 2 : 3} of 3
            </div>
            <h2 className="text-[18px] font-bold tracking-[-0.01em] text-fg">{title}</h2>
          </div>
          {/* Hidden mid-request and on the codes step: there the only way
              out is the explicit "I've saved these" button (Escape and the
              backdrop still ask first). */}
          {submitting || step === STEP_DONE ? null : (
            <IconButton label="Close" size="sm" onClick={requestClose}>
              <X size={16} />
            </IconButton>
          )}
        </div>

        {step === STEP_VERIFY ? (
          <form onSubmit={handleStart} className="mt-3 flex flex-col gap-4">
            <p className="text-[13px] leading-[1.55] text-muted-fg">
              {shortcut
                ? "You signed in with a backup code a moment ago, so your password is all we need. Your current setup keeps working until the new phone is confirmed."
                : "Confirm it's you with your password and a code from your current authenticator app — or one of your backup codes if the old phone is gone. Nothing changes until the new phone is confirmed."}
            </p>
            <Field label="Password">
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                autoFocus
                required
              />
            </Field>
            {shortcut ? null : (
              <>
                <SegmentedControl as="radiogroup" ariaLabel="Verification method"
                  size="sm"
                  onCard
                  options={FACTOR_OPTIONS}
                  value={factor}
                  onChange={(v) => {
                    setFactor(v);
                    setCode("");
                    setBackupCode("");
                    setError(null);
                  }}
                />
                {factor === "code" ? (
                  <Field label="Code from your current app">
                    <Input
                      key="code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="\d{6}"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                      disabled={submitting}
                      required
                      className="text-center font-mono text-[20px] tracking-[0.3em]"
                    />
                  </Field>
                ) : (
                  <Field
                    label="Backup code"
                    hint="It's used up once you continue, even if you cancel later."
                  >
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
                      disabled={submitting}
                      required
                      className="text-center font-mono text-[18px] tracking-[0.12em]"
                    />
                  </Field>
                )}
              </>
            )}
            <AuthError>{error}</AuthError>
            <div className="flex gap-2">
              <Button type="button" size="md" variant="soft" className="flex-1" onClick={requestClose} disabled={submitting}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="md"
                className="flex-1"
                disabled={!password || !factorReady || submitting}
              >
                {submitting ? "Checking…" : "Continue"}
              </Button>
            </div>
          </form>
        ) : step === STEP_SCAN ? (
          <form onSubmit={handleConfirm} className="mt-3 flex flex-col gap-4">
            <p className="text-[13px] leading-[1.55] text-muted-fg">
              Add eSpace Hubs to the authenticator app on your new phone, then
              enter the 6-digit code it shows. Your old phone keeps working
              until you do.
            </p>
            <TotpSecretPanel otpauthUrl={otpauthUrl} secret={secret} className="" />
            <Field label="Code from your new phone">
              <Input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.replace(/\D/g, ""))}
                disabled={submitting}
                autoFocus
                required
                className="text-center font-mono text-[20px] tracking-[0.3em]"
              />
            </Field>
            <AuthError>{error}</AuthError>
            <div className="flex gap-2">
              <Button type="button" size="md" variant="soft" className="flex-1" onClick={requestClose} disabled={submitting}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="md"
                className="flex-1"
                disabled={newCode.length !== 6 || submitting}
              >
                {submitting ? "Confirming…" : "Confirm new phone"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            <Card tone="mint" radius="lg" padding={14} className="text-[13px] leading-[1.55]">
              <div className="font-bold">Your new phone is set up</div>
              <p className="mt-1">
                Codes from the old phone no longer work, and your other signed-in
                devices will ask for a code from the new one.
              </p>
            </Card>
            <p className="text-[13px] leading-[1.55] text-muted-fg">
              Your old backup codes stopped working. Save these — this is the
              only time they&apos;re shown.
            </p>
            <BackupCodesPanel codes={codes ?? []} email={email} onSaved={() => setCodesSaved(true)} />
            <Button size="md" className="w-full" onClick={onClose}>
              I&apos;ve saved these — done
            </Button>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}

function humanise(err) {
  if (!err) return "Something went wrong. Try again.";
  switch (err.code) {
    case "invalid_password":
      return "Password did not match.";
    case "invalid_totp_code":
      return "Code did not match. Try the next one your app generates.";
    case "invalid_backup_code":
      return "That backup code didn't work — it may be mistyped or already used.";
    case "factor_required":
      return "Enter a code from your current app, or one of your backup codes.";
    case "reenrol_expired":
    case "reenrol_not_started":
    case "reenrol_superseded":
      return "That setup expired. Confirm it's you again to get a fresh QR code.";
    case "totp_not_enrolled":
      return "Two-factor isn't set up on this account.";
    case "rate_limited":
      return "Too many attempts. Wait a moment and try again.";
    case "network_error":
      return "Couldn't reach the server. Check your connection and retry.";
    default:
      return err.message || "Something went wrong. Try again.";
  }
}

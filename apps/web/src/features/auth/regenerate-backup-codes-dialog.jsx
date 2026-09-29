"use client";

/**
 * "Generate new codes" dialog for Settings → Account.
 *
 * Two steps in one small modal:
 *   1. Ask for a current 6-digit authenticator code (proof the person at
 *      the keyboard still holds the second factor — a stolen cookie
 *      alone can't mint recovery codes).
 *   2. POST /auth/totp/backup-codes/regenerate → show the new codes
 *      once, with copy / download. Every old code stops working.
 *
 * Same overlay contract as the app's other dialogs: portal, focus trap,
 * Escape, backdrop click — except that nothing closes it mid-request, and
 * once the new codes are shown, closing without copying or downloading
 * them asks first (the old codes are already gone).
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { X } from "lucide-react";
import { apiPost } from "@/lib/api-client";
import { Button, Field, IconButton, Input, useFocusTrap } from "@/components/ui";
import { AuthError } from "./auth-card.jsx";
import { BackupCodesPanel } from "./backup-codes-panel.jsx";
import { useCodesDialogClose } from "./use-codes-dialog-close.js";

export function RegenerateBackupCodesDialog({ open, onClose, email, onRegenerated }) {
  const trapRef = useFocusTrap(open);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState(null);
  const [codesSaved, setCodesSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const { requestClose, snapshot, isCurrent } = useCodesDialogClose({
    open,
    onClose,
    submitting,
    codesShown: codes != null,
    codesSaved,
  });

  // Reset on every open and close — the plaintext codes must not linger
  // in state, and a new opening always starts at the code prompt.
  useEffect(() => {
    setCode("");
    setCodes(null);
    setCodesSaved(false);
    setError(null);
    setSubmitting(false);
  }, [open]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (code.length !== 6) return;
    setError(null);
    setSubmitting(true);
    const snap = snapshot();
    const r = await apiPost("/auth/totp/backup-codes/regenerate", { code });
    // Closed (or re-opened) while this was out — never repopulate the dialog.
    if (!isCurrent(snap)) return;
    setSubmitting(false);
    if (!r.ok) {
      setCode("");
      setError(humanise(r.error));
      return;
    }
    setCodes(r.data?.backupCodes ?? []);
    toast.success("New backup codes generated. The old ones no longer work.");
    onRegenerated?.();
  }

  if (!open || typeof document === "undefined") return null;

  const title = codes ? "Your new backup codes" : "Generate new backup codes";

  return createPortal(
    <>
      <div className="fixed inset-0 z-[70] bg-scrim" onClick={requestClose} aria-hidden="true" />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed left-1/2 top-1/2 z-[71] max-h-[calc(100vh-32px)] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-xl)] bg-card p-6"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[18px] font-bold tracking-[-0.01em] text-fg">{title}</h2>
          {submitting || codes ? null : (
            <IconButton label="Close" size="sm" onClick={requestClose}>
              <X size={16} />
            </IconButton>
          )}
        </div>

        {codes ? (
          <div className="mt-3 flex flex-col gap-4">
            <p className="text-[13px] leading-[1.55] text-muted-fg">
              Save these somewhere safe — this is the only time they&apos;re
              shown. Each one works once in place of your authenticator code.
            </p>
            <BackupCodesPanel codes={codes} email={email} onSaved={() => setCodesSaved(true)} />
            <Button size="md" className="w-full" onClick={onClose}>
              I&apos;ve saved these — done
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-4">
            <p className="text-[13px] leading-[1.55] text-muted-fg">
              Enter a current code from your authenticator app. Your existing
              backup codes stop working as soon as the new ones are made.
            </p>
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
                required
                className="text-center font-mono text-[20px] tracking-[0.3em]"
              />
            </Field>
            <AuthError>{error}</AuthError>
            <Button
              type="submit"
              size="md"
              className="w-full"
              disabled={code.length !== 6 || submitting}
            >
              {submitting ? "Generating…" : "Generate new codes"}
            </Button>
          </form>
        )}
      </div>
    </>,
    document.body,
  );
}

function humanise(err) {
  if (!err) return "Something went wrong. Try again.";
  if (err.code === "invalid_totp_code")
    return "Code did not match. Try the next one your app generates.";
  if (err.code === "rate_limited")
    return "Too many attempts. Wait a moment and try again.";
  if (err.code === "totp_not_enrolled")
    return "Two-factor isn't set up on this account.";
  if (err.code === "network_error")
    return "Couldn't reach the server. Check your connection and retry.";
  return err.message || "Something went wrong. Try again.";
}

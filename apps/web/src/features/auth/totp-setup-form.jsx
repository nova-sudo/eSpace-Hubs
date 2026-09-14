"use client";

/**
 * TOTP enrolment form. Mounted at /totp-setup.
 *
 * Two-step ceremony:
 *   1. On mount, POST /api/v1/auth/totp/enrol — server generates a
 *      fresh base32 secret, encrypts + persists it as PENDING
 *      (totpSecret set, totpEnrolledAt still null), and returns
 *      { secret, otpauthUrl }.
 *   2. The user scans the QR into their authenticator OR manually
 *      types the secret. They submit the 6-digit code their app
 *      generates. We POST /api/v1/auth/totp/verify-enrolment.
 *      Server confirms the code matches and sets totpEnrolledAt.
 *
 * Why enrolment happens after the first login + before onboarding:
 * a fresh user lands here with `totpVerified: true` (the session was
 * minted that way because they had no TOTP at login), but the
 * AuthGuard refuses to let them past until totpEnrolled flips true.
 * Doing this BEFORE the onboarding profile fields means we
 * establish 2FA before they hand over any PII.
 *
 * QR rendering uses the `qrcode` npm package client-side. The
 * provisioning URL contains the user's email + the raw secret —
 * it MUST NOT be sent to a third-party QR API (e.g. Google Charts).
 * Local-only rendering keeps the secret inside the browser.
 *
 * Errors surfaced from the API:
 *   totp_already_enrolled   → "TOTP is already set up — refresh."
 *   invalid_state           → "Enrolment expired — restart."
 *   invalid_totp_code       → "Code did not match. Try the next one."
 *   network_error           → generic retry copy
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import QRCode from "qrcode";
import { apiPost } from "@/lib/api-client";
import { Button, Field, Input, Label, Loading } from "@/components/ui";
import { AuthCard, AuthError } from "./auth-card.jsx";
import { useSession } from "./use-session.js";

const PHASE_LOADING = "loading";
const PHASE_SHOW_SECRET = "show_secret";
const PHASE_VERIFY = "verify";
const PHASE_DONE = "done";

export function TotpSetupForm() {
  const { refresh } = useSession();
  const [phase, setPhase] = useState(PHASE_LOADING);
  const [secret, setSecret] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const startedRef = useRef(false);

  // Kick off enrolment once on mount. Strict-mode would double-fire
  // useEffect in dev — `startedRef` makes the second call a no-op so
  // we don't generate two pending secrets on the server (the second
  // /enrol call would overwrite the first, which is harmless but
  // confuses the audit log).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      const r = await apiPost("/auth/totp/enrol", {});
      if (!r.ok) {
        setError(humanise(r.error));
        setPhase(PHASE_VERIFY); // give the user a path forward via the input
        return;
      }
      setSecret(r.data?.secret ?? "");
      setOtpauthUrl(r.data?.otpauthUrl ?? "");
      setPhase(PHASE_SHOW_SECRET);
    })();
  }, []);

  // Render the QR client-side from the otpauth URL. The URL contains
  // the user's email + raw secret — sending it to a third-party QR
  // service would leak the secret, so the encoding happens in the
  // browser only.
  useEffect(() => {
    if (!otpauthUrl) return;
    let cancelled = false;
    (async () => {
      try {
        // No explicit `color` override — the library's default pure
        // black/white gives the best scan contrast, and a QR code's
        // pixels aren't a themed UI surface anyway.
        const dataUrl = await QRCode.toDataURL(otpauthUrl, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 220,
        });
        if (!cancelled) setQrDataUrl(dataUrl);
      } catch {
        // QR rendering failure is non-fatal — the secret + URL fall back
        // panels still let the user finish enrolment via manual entry.
        if (!cancelled) setQrDataUrl("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [otpauthUrl]);

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
      setError(humanise(r.error));
      setCode("");
      return;
    }
    // Refresh the session so user.totpEnrolled flips to true →
    // AuthGuard's next render lets the user proceed.
    await refresh();
    setPhase(PHASE_DONE);
    toast.success("Two-factor enabled.");
  }

  const title = phase === PHASE_DONE ? "Enabled" : "Two-factor";
  const lead =
    phase === PHASE_DONE
      ? "Your account now requires a 6-digit code at sign-in."
      : "Scan the QR with your authenticator, then enter the 6-digit code it generates.";

  return (
    <AuthCard title={title} lead={lead}>
      {phase === PHASE_LOADING ? (
        <Loading label="Generating your secret…" />
      ) : phase === PHASE_DONE ? (
        <p className="text-[13.5px] leading-[1.55] text-muted-fg">
          Routing you to the next step…
        </p>
      ) : (
        <>
          {phase === PHASE_SHOW_SECRET ? (
            <SecretPanel qrDataUrl={qrDataUrl} secret={secret} />
          ) : null}

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

function SecretPanel({ qrDataUrl, secret }) {
  const formatted = useMemo(() => formatSecret(secret), [secret]);

  return (
    <div className="mb-5 flex items-center gap-4 rounded-[var(--radius-lg)] bg-card-alt p-4">
      {qrDataUrl ? (
        <img
          src={qrDataUrl}
          alt="TOTP QR code"
          width={96}
          height={96}
          className="block shrink-0 rounded-[var(--radius-md)] bg-white p-2"
        />
      ) : (
        <div className="flex h-24 w-24 shrink-0 items-center text-center text-[11px] text-muted-fg">
          QR rendering failed — use manual entry.
        </div>
      )}

      <div className="min-w-0">
        <Label>Manual entry secret</Label>
        <code className="mt-1 block break-all font-mono text-[12px] leading-[1.5] text-fg">
          {formatted}
        </code>
        <div className="mt-2 text-[11.5px] text-dim-fg">
          SHA-1 · 6 digits · 30s period
        </div>
      </div>
    </div>
  );
}

/**
 * Pretty-print the base32 secret in groups of four for manual entry.
 * Authenticator apps don't care about spacing — they strip whitespace —
 * but humans typing a 32-char string benefit from chunking.
 */
function formatSecret(s) {
  if (!s) return "";
  return s.replace(/(.{4})/g, "$1 ").trim();
}

function humanise(err) {
  if (!err) return "Something went wrong. Try again.";
  if (err.code === "totp_already_enrolled")
    return "Two-factor is already set up. Refresh the page to continue.";
  if (err.code === "invalid_state")
    return "Enrolment session expired. Refresh the page to restart.";
  if (err.code === "invalid_totp_code")
    return "Code did not match. Try the next one your app generates.";
  if (err.code === "totp_secret_corrupted")
    return "Stored secret couldn't be read. Refresh the page to start over.";
  if (err.code === "rate_limited")
    return "Too many attempts. Wait a moment and try again.";
  if (err.code === "validation_error")
    return err.message || "Code must be 6 digits.";
  if (err.code === "network_error")
    return "Couldn't reach the server. Check your connection and retry.";
  return err.message || "Something went wrong. Try again.";
}

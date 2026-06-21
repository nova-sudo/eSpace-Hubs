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
        const dataUrl = await QRCode.toDataURL(otpauthUrl, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 220,
          color: { dark: "#0b0b0c", light: "#ffffff" },
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

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 py-12">
      <Header phase={phase} />

      {phase === PHASE_LOADING ? (
        <LoadingPanel />
      ) : phase === PHASE_DONE ? (
        <DonePanel />
      ) : (
        <>
          {phase === PHASE_SHOW_SECRET ? (
            <SecretPanel qrDataUrl={qrDataUrl} secret={secret} />
          ) : null}

          <form
            onSubmit={handleVerify}
            className="flex flex-col gap-3"
          >
            <CodeInput
              value={code}
              onChange={setCode}
              disabled={submitting}
            />

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
              disabled={code.length !== 6 || submitting}
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
                opacity: code.length === 6 && !submitting ? 1 : 0.6,
              }}
            >
              {submitting ? "Verifying…" : "Verify & enable"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

function Header({ phase }) {
  const title =
    phase === PHASE_DONE ? "Two-factor enabled." : "Set up two-factor.";
  const subtitle =
    phase === PHASE_DONE
      ? "Your account now requires a 6-digit code at sign-in."
      : "Required before you can use the app. Scan the QR with an authenticator app (1Password, Authy, Google Authenticator, etc.), then enter the 6-digit code it generates.";

  return (
    <div>
      <h1
        className="font-semibold"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 28,
          letterSpacing: "-0.8px",
        }}
      >
        {title}
      </h1>
      <p
        className="mt-1 text-muted-fg"
        style={{ fontSize: 13.5, lineHeight: 1.5 }}
      >
        {subtitle}
      </p>
    </div>
  );
}

function LoadingPanel() {
  return (
    <div
      className="text-muted-fg"
      style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}
    >
      Generating your secret…
    </div>
  );
}

function SecretPanel({ qrDataUrl, secret }) {
  const formatted = useMemo(() => formatSecret(secret), [secret]);

  return (
    <div
      className="flex flex-col items-center gap-4 rounded-md border bg-card p-5"
      style={{ borderColor: "var(--border-strong)" }}
    >
      {qrDataUrl ? (
        <img
          src={qrDataUrl}
          alt="TOTP QR code"
          width={220}
          height={220}
          style={{
            display: "block",
            background: "#fff",
            borderRadius: 4,
          }}
        />
      ) : (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--muted-fg)",
          }}
        >
          QR rendering failed — use manual entry below.
        </div>
      )}

      <div className="w-full">
        <div
          className="mb-1 uppercase tracking-[0.4px] text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
        >
          Manual entry secret
        </div>
        <code
          className="block break-all rounded-sm border bg-card-alt px-3 py-2 text-fg"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            letterSpacing: "0.6px",
            borderColor: "var(--border)",
          }}
        >
          {formatted}
        </code>
        <div
          className="mt-1 text-muted-fg"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.3px",
          }}
        >
          Algorithm: SHA-1 · 6 digits · 30-second period
        </div>
      </div>
    </div>
  );
}

function CodeInput({ value, onChange, disabled }) {
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
        Code from your authenticator
      </span>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        disabled={disabled}
        autoFocus
        required
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 18,
          letterSpacing: "8px",
          padding: "10px 14px",
          textAlign: "center",
          background: "var(--card)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-sub, 3px)",
          outline: "none",
        }}
      />
    </label>
  );
}

function DonePanel() {
  // The AuthGuard re-renders after the refresh() call, which routes
  // the user onward (to /onboarding if their profile is incomplete,
  // else to /). This panel is only briefly visible. We don't push
  // router.replace() here because the guard's effect handles it —
  // doing both would race.
  return (
    <div
      className="rounded-md border bg-card p-4"
      style={{ borderColor: "var(--border-strong)" }}
    >
      <p
        className="text-fg"
        style={{ fontSize: 13.5, lineHeight: 1.55 }}
      >
        Routing you to the next step…
      </p>
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

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

/* ── Nothing UI auth chrome (inlined per file — mirrors the reference
   ScreenAuth.dc.html "totp" variant in the migration kit). ────────── */

const FIELD_LABEL = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "1.5px",
  color: "var(--muted-fg)",
};

const ERROR = {
  fontFamily: "var(--font-mono)",
  fontSize: 11.5,
  color: "var(--bad)",
};

const BRAND = {
  brandTitle: ["Lock it", "down"],
  brandBody:
    "Two-factor is required before you reach the app. Your secret stays in this browser.",
  flow: ["Sign up", "2FA", "Onboarding"],
  flowActive: 1,
};

function AuthShell({ brandTitle, brandBody, flow, flowActive, children }) {
  return (
    <div
      style={{
        "--brand-bg": "#000",
        "--brand-fg": "#fff",
        "--brand-muted": "rgba(255,255,255,0.6)",
        "--brand-dim": "rgba(255,255,255,0.22)",
        "--brand-line": "rgba(255,255,255,0.22)",
        "--brand-dot": "rgba(255,255,255,0.13)",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 1fr)",
        minHeight: "100vh",
        background: "var(--bg)",
      }}
      className="auth-shell"
    >
      <div
        className="auth-brand"
        style={{
          position: "relative",
          overflow: "hidden",
          background: "var(--brand-bg)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "46px 44px",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "radial-gradient(var(--brand-dot) 1.1px, transparent 1.1px)",
            backgroundSize: "11px 11px",
            opacity: 0.6,
            pointerEvents: "none",
          }}
        />
        <BrandMark />
        <div style={{ position: "relative" }}>
          <div
            style={{
              fontFamily: "var(--font-dot)",
              fontWeight: 900,
              fontSize: 54,
              lineHeight: 0.9,
              letterSpacing: "1px",
              textTransform: "uppercase",
              color: "var(--brand-fg)",
            }}
          >
            {brandTitle.map((line, i) => (
              <span key={i}>
                {line}
                {i < brandTitle.length - 1 ? <br /> : null}
              </span>
            ))}
            <span style={{ color: "var(--accent)" }}>.</span>
          </div>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 14.5,
              lineHeight: 1.55,
              color: "var(--brand-muted)",
              maxWidth: 340,
              margin: "22px 0 0",
            }}
          >
            {brandBody}
          </p>
        </div>
        <FlowPills flow={flow} active={flowActive} />
      </div>

      <div
        style={{
          background: "var(--bg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 40,
        }}
      >
        <div style={{ width: "100%", maxWidth: 380 }}>{children}</div>
      </div>

      <style>{`
        @media (max-width: 720px) {
          .auth-shell { grid-template-columns: 1fr !important; }
          .auth-brand { display: none !important; }
        }
      `}</style>
    </div>
  );
}

function BrandMark() {
  const cell = (bg) => <i style={{ background: bg, borderRadius: "50%" }} />;
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 11,
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 7,
          border: "1px solid var(--brand-line)",
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gridTemplateRows: "repeat(3, 1fr)",
          gap: 3,
          padding: 6,
        }}
      >
        {cell("var(--brand-fg)")}
        {cell("var(--brand-dim)")}
        {cell("var(--brand-fg)")}
        {cell("var(--brand-dim)")}
        {cell("var(--accent)")}
        {cell("var(--brand-dim)")}
        {cell("var(--brand-fg)")}
        {cell("var(--brand-dim)")}
        {cell("var(--brand-fg)")}
      </div>
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontWeight: 700,
          fontSize: 16,
          color: "var(--brand-fg)",
        }}
      >
        eSpace<span style={{ color: "var(--accent)" }}>/</span>DevHub
      </span>
    </div>
  );
}

function FlowPills({ flow = [], active = 0 }) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 9,
        flexWrap: "wrap",
      }}
    >
      {flow.map((label, i) => {
        const on = i <= active;
        return (
          <span
            key={i}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              textTransform: "uppercase",
              letterSpacing: "1px",
              color: on ? "var(--brand-fg)" : "var(--brand-dim)",
              border: `1px solid ${on ? "var(--accent)" : "var(--brand-line)"}`,
              borderRadius: 999,
              padding: "4px 9px",
            }}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

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
    <AuthShell {...BRAND}>
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

          <form onSubmit={handleVerify} className="flex flex-col gap-3">
            <CodeInput value={code} onChange={setCode} disabled={submitting} />

            {error ? <div style={ERROR}>{error}</div> : null}

            <button
              type="submit"
              disabled={code.length !== 6 || submitting}
              style={{
                width: "100%",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "1px",
                color: "var(--accent-on)",
                background: "var(--accent)",
                border: 0,
                borderRadius: "var(--radius-sub)",
                padding: 13,
                cursor: submitting ? "wait" : "pointer",
                opacity: code.length === 6 && !submitting ? 1 : 0.6,
              }}
            >
              {submitting ? "Verifying…" : "Verify & enable →"}
            </button>
          </form>
        </>
      )}
    </AuthShell>
  );
}

function Header({ phase }) {
  const title = phase === PHASE_DONE ? "Enabled" : "Two-factor";
  const subtitle =
    phase === PHASE_DONE
      ? "Your account now requires a 6-digit code at sign-in."
      : "Scan the QR with your authenticator, then enter the 6-digit code it generates.";

  return (
    <div>
      <h1
        style={{
          fontFamily: "var(--font-dot)",
          fontWeight: 900,
          fontSize: 30,
          letterSpacing: "1px",
          textTransform: "uppercase",
          color: "var(--fg)",
          margin: 0,
        }}
      >
        {title}
      </h1>
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--muted-fg)",
          margin: "9px 0 20px",
        }}
      >
        {subtitle}
      </p>
    </div>
  );
}

function LoadingPanel() {
  return (
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11.5,
        color: "var(--muted-fg)",
      }}
    >
      Generating your secret…
    </div>
  );
}

function SecretPanel({ qrDataUrl, secret }) {
  const formatted = useMemo(() => formatSecret(secret), [secret]);

  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        alignItems: "center",
        border: "1px solid var(--border-strong)",
        borderRadius: 9,
        background: "var(--card)",
        padding: 16,
        marginBottom: 16,
      }}
    >
      {qrDataUrl ? (
        <img
          src={qrDataUrl}
          alt="TOTP QR code"
          width={108}
          height={108}
          style={{
            display: "block",
            flex: "none",
            background: "#fff",
            borderRadius: 6,
            padding: 8,
            boxSizing: "content-box",
          }}
        />
      ) : (
        <div
          style={{
            width: 108,
            height: 108,
            flex: "none",
            display: "flex",
            alignItems: "center",
            textAlign: "center",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--muted-fg)",
          }}
        >
          QR rendering failed — use manual entry.
        </div>
      )}

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            textTransform: "uppercase",
            letterSpacing: "1px",
            color: "var(--muted-fg)",
            marginBottom: 5,
          }}
        >
          Manual entry secret
        </div>
        <code
          style={{
            display: "block",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            letterSpacing: "1px",
            color: "var(--fg)",
            wordBreak: "break-all",
            lineHeight: 1.5,
          }}
        >
          {formatted}
        </code>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            color: "var(--dim-fg)",
            marginTop: 8,
          }}
        >
          SHA-1 · 6 digits · 30s period
        </div>
      </div>
    </div>
  );
}

function CodeInput({ value, onChange, disabled }) {
  return (
    <label className="flex flex-col gap-[7px]">
      <span style={FIELD_LABEL}>Code from your app</span>
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
          fontFamily: "var(--font-dot)",
          fontWeight: 700,
          fontSize: 22,
          letterSpacing: "12px",
          textAlign: "center",
          color: "var(--fg)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-sub)",
          padding: "9px 14px",
          background: "var(--card)",
          outline: "none",
          width: "100%",
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
      style={{
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius-tile)",
        background: "var(--card)",
        padding: 16,
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 13.5,
          lineHeight: 1.55,
          color: "var(--fg)",
          margin: 0,
        }}
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

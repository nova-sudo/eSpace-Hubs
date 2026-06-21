"use client";

/**
 * Two-step login form.
 *
 *   Step 1: email + password
 *           → on success, if needsTotp, swap to step 2; else done
 *   Step 2: 6-digit TOTP code
 *           → on success, fully authenticated; consumer redirects
 *
 * Errors:
 *   - Wrong email/password           → "Invalid email or password."
 *   - Wrong TOTP code                → "Code did not match."
 *   - Network error                  → generic copy with retry
 *
 * No password manager hints — the form is deliberately simple
 * (single `autocomplete="email" / autocomplete="current-password"`)
 * so credential autofill works without surprises.
 */

import { useState } from "react";
import Link from "next/link";
import { useSession } from "./use-session.js";

/* ── Nothing UI auth chrome (inlined per file — see CLAUDE.md "features
   are the boundary"; the brand panel + field styles below mirror the
   reference ScreenLogin.dc.html in the migration kit). ─────────────── */

const FIELD_LABEL = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "1.5px",
  color: "var(--muted-fg)",
};

const INPUT = {
  fontFamily: "var(--font-mono)",
  fontSize: 13,
  color: "var(--fg)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-sub)",
  padding: "11px 14px",
  background: "var(--card)",
  outline: "none",
  width: "100%",
};

const BUTTON_BASE = {
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
};

const ERROR = {
  fontFamily: "var(--font-mono)",
  fontSize: 11.5,
  color: "var(--bad)",
};

function buttonStyle({ busy, enabled }) {
  return {
    ...BUTTON_BASE,
    cursor: busy ? "wait" : "pointer",
    opacity: enabled ? 1 : 0.6,
  };
}

/**
 * Two-panel auth shell: dark brand panel (dot-grid texture, dot-matrix
 * logo glyph + Doto wordmark headline) beside a centred form panel.
 * Collapses to a single column on narrow viewports.
 */
function AuthShell({ brandTitle, brandBody, brandFooter, children }) {
  return (
    <div
      style={{
        // Brand-panel-only tokens (the panel is always dark per the
        // reference); the form panel reads the global --bg/--fg tokens
        // so it follows light/dark mode.
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
      {/* Brand panel */}
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
              fontSize: 58,
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
        <div style={{ position: "relative" }}>{brandFooter}</div>
      </div>

      {/* Form panel */}
      <div
        style={{
          background: "var(--bg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 40,
        }}
      >
        <div style={{ width: "100%", maxWidth: 360 }}>{children}</div>
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

/** 3×3 dot-matrix logo glyph + eSpace/DevHub wordmark. */
function BrandMark() {
  const cell = (bg) => (
    <i style={{ background: bg, borderRadius: "50%" }} />
  );
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

/** Doto uppercase page title. */
function AuthTitle({ children, size = 38 }) {
  return (
    <h1
      style={{
        fontFamily: "var(--font-dot)",
        fontWeight: 900,
        fontSize: size,
        letterSpacing: "1px",
        textTransform: "uppercase",
        color: "var(--fg)",
        margin: 0,
      }}
    >
      {children}
    </h1>
  );
}

/** Hanken lead paragraph under the title. */
function AuthLead({ children }) {
  return (
    <p
      style={{
        fontFamily: "var(--font-sans)",
        fontSize: 13.5,
        lineHeight: 1.5,
        color: "var(--muted-fg)",
        margin: "10px 0 28px",
      }}
    >
      {children}
    </p>
  );
}

export function LoginForm({ onSuccess }) {
  const { user, needsTotp, error, login, verifyTotp, loading } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // If already logged in OR step-2 completed, bubble up.
  if (user) {
    onSuccess?.(user);
    return null;
  }

  async function handlePassword(e) {
    e.preventDefault();
    setSubmitting(true);
    const result = await login({ email, password });
    setSubmitting(false);
    if (result.ok && !result.needsTotp) {
      onSuccess?.();
    }
  }

  async function handleTotp(e) {
    e.preventDefault();
    setSubmitting(true);
    const result = await verifyTotp({ code });
    setSubmitting(false);
    if (result.ok) {
      onSuccess?.();
    } else {
      // Clear the input so the user can re-type the next 30-second code.
      setCode("");
    }
  }

  const errorMessage = error ? humanizeError(error) : null;

  return (
    <AuthShell
      brandTitle={["Your", "evidence,", "in one", "place"]}
      brandBody="Every PR, review, and goal reading — gathered, classified, and review-ready. Nothing leaves your browser."
      brandFooter={<TickStrip total={14} on={9} />}
    >
      <AuthTitle>Sign in</AuthTitle>
      <AuthLead>
        eSpace Dev Hub — your performance evidence, in one place.
      </AuthLead>

      {needsTotp ? (
        <form className="flex flex-col gap-3" onSubmit={handleTotp}>
          <label className="flex flex-col gap-[7px]">
            <span style={FIELD_LABEL}>
              6-digit code from your authenticator
            </span>
            <input
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
              style={{
                ...INPUT,
                fontSize: 18,
                letterSpacing: "8px",
                textAlign: "center",
              }}
            />
          </label>
          {errorMessage ? <div style={ERROR}>{errorMessage}</div> : null}
          <button
            type="submit"
            disabled={code.length !== 6 || submitting || loading}
            style={{
              ...buttonStyle({
                busy: submitting,
                enabled: code.length === 6 && !submitting,
              }),
              marginTop: 18,
            }}
          >
            {submitting ? "Verifying…" : "Verify code →"}
          </button>
        </form>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={handlePassword}>
          <label className="flex flex-col gap-[7px]">
            <span style={FIELD_LABEL}>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting || loading}
              autoFocus
              required
              style={INPUT}
            />
          </label>
          <label className="flex flex-col gap-[7px]">
            <span style={FIELD_LABEL}>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting || loading}
              required
              minLength={8}
              style={INPUT}
            />
          </label>
          {errorMessage ? <div style={ERROR}>{errorMessage}</div> : null}
          <button
            type="submit"
            disabled={submitting || loading}
            style={{
              ...buttonStyle({ busy: submitting, enabled: !submitting }),
              marginTop: 4,
            }}
          >
            {submitting ? "Signing in…" : "Continue →"}
          </button>

          {/* Forgot-password link — only on the password step, not the
              TOTP step (a user on step 2 already authenticated and is
              just stuck on the 6-digit code; the right recovery there
              is backup codes, not password reset). */}
          <div
            className="mt-[6px] flex flex-col gap-[9px]"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--muted-fg)",
              textAlign: "center",
            }}
          >
            <Link
              href="/forgot-password"
              className="text-accent hover:underline"
              style={{ fontWeight: 600 }}
            >
              Forgot password?
            </Link>
            <div>
              Don't have an account?{" "}
              <Link
                href="/signup"
                className="text-accent hover:underline"
                style={{ fontWeight: 600 }}
              >
                Create one
              </Link>
            </div>
          </div>
        </form>
      )}

      {!needsTotp ? (
        <div
          className="mt-7 flex items-center gap-[10px]"
          aria-hidden
        >
          <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              textTransform: "uppercase",
              letterSpacing: "1px",
              color: "var(--dim-fg)",
            }}
          >
            2FA protected
          </span>
          <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>
      ) : null}
    </AuthShell>
  );
}

/** Brand-footer tick strip — accent dots fading into dim dots. */
function TickStrip({ total, on }) {
  return (
    <div style={{ display: "flex", gap: 7 }}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: i < on ? "var(--accent)" : "var(--brand-dim)",
          }}
        />
      ))}
    </div>
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
    case "network_error":
      return "Couldn't reach the server. Check your connection and retry.";
    case "totp_required":
      // The form swapped to step 2; this shouldn't surface.
      return null;
    default:
      return err.message || "Something went wrong. Try again.";
  }
}

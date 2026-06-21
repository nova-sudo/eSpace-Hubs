"use client";

/**
 * Password-reset *request* form. Mounted at /forgot-password.
 *
 * Takes an email, POSTs to /api/v1/auth/password/reset-request, which:
 *   - always returns { ok: true } (tells an attacker nothing about
 *     which emails are registered — enumeration defense)
 *   - if the address resolves to an active, password-set user, mints
 *     a single-use reset token + emails the link
 *
 * Because the server intentionally hides "no such user" from the
 * caller, this form's success state is identical for valid and
 * invalid inputs: "if an account exists, an email is on its way."
 * Anything more specific would leak account existence.
 *
 * Rate-limited server-side at the per-IP layer
 * (`passwordResetRequestLimiter`); the form additionally disables the
 * submit button while in flight to prevent accidental double-fires.
 */

import { useState } from "react";
import Link from "next/link";
import { apiPost } from "@/lib/api-client";

/* ── Nothing UI auth chrome (inlined per file — mirrors the reference
   ScreenAuth.dc.html "forgot" variant in the migration kit). ──────── */

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
  border: "1px solid var(--accent)",
  borderRadius: "var(--radius-sub)",
  padding: "11px 14px",
  background: "var(--card)",
  outline: "none",
  width: "100%",
};

const ERROR = {
  fontFamily: "var(--font-mono)",
  fontSize: 11.5,
  color: "var(--bad)",
};

const BRAND = {
  brandTitle: ["Locked", "out?"],
  brandBody:
    "Happens to everyone. We'll get you back to your evidence in two steps.",
  flow: ["Email", "Reset link", "New password"],
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

function Title({ children, size = 32 }) {
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

function Lead({ children, mb = 26 }) {
  return (
    <p
      style={{
        fontFamily: "var(--font-sans)",
        fontSize: 13.5,
        lineHeight: 1.5,
        color: "var(--muted-fg)",
        margin: `10px 0 ${mb}px`,
      }}
    >
      {children}
    </p>
  );
}

export function PasswordResetRequestForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const r = await apiPost("/auth/password/reset-request", { email });
    setSubmitting(false);
    if (!r.ok) {
      // Reset-request is enumeration-safe on the happy path — the
      // only errors that reach the client are rate-limit / validation
      // / network. Surface them; don't swallow.
      setError(humanise(r.error));
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <AuthShell {...BRAND} flowActive={1}>
        <Title size={28}>Check your inbox.</Title>
        <Lead mb={4}>
          If <span style={{ color: "var(--fg)" }}>{email}</span> is registered,
          we&apos;ve sent you a reset link. Open the link from the same browser
          you signed in with. The link expires soon — request a fresh one if
          it&apos;s already gone stale.
        </Lead>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--muted-fg)",
            marginTop: 14,
          }}
        >
          Didn&apos;t get it? Double-check the address, then{" "}
          <Link
            href="/login"
            className="text-accent hover:underline"
            style={{ fontWeight: 600 }}
          >
            back to sign-in
          </Link>{" "}
          and try again.
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell {...BRAND} flowActive={1}>
      <Title>Reset password</Title>
      <Lead>
        Enter the email tied to your account. If we recognise it, you&apos;ll
        get a link to set a new password.
      </Lead>

      <form className="flex flex-col" onSubmit={handleSubmit}>
        <label className="flex flex-col gap-[7px]" style={{ marginBottom: 18 }}>
          <span style={FIELD_LABEL}>Email</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            autoFocus
            required
            style={INPUT}
          />
        </label>

        {error ? <div style={{ ...ERROR, marginBottom: 12 }}>{error}</div> : null}

        <button
          type="submit"
          disabled={!email || submitting}
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
            opacity: email && !submitting ? 1 : 0.6,
          }}
        >
          {submitting ? "Sending…" : "Send reset link →"}
        </button>
      </form>

      <div
        className="text-center"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--muted-fg)",
          marginTop: 18,
        }}
      >
        Remembered it?{" "}
        <Link
          href="/login"
          className="text-accent hover:underline"
          style={{ fontWeight: 600 }}
        >
          Back to sign-in
        </Link>
      </div>
    </AuthShell>
  );
}

function humanise(err) {
  if (!err) return "Something went wrong. Try again.";
  if (err.code === "rate_limited")
    return "Too many requests from this network. Wait a few minutes and try again.";
  if (err.code === "validation_error")
    return err.message || "That doesn't look like a valid email.";
  if (err.code === "network_error")
    return "Couldn't reach the server. Check your connection and try again.";
  return err.message || "Something went wrong. Try again.";
}

"use client";

/**
 * Password-reset *redemption* form. Mounted at /password-reset?token=…
 *
 * Reads the single-use token from the URL, captures a new password +
 * confirmation, POSTs to /api/v1/auth/password/reset. The server:
 *   1. Redeems the token (one-shot — same token can't be reused).
 *   2. argon2id-hashes the new password.
 *   3. Force-logs out every existing session for this user (so a
 *      compromised session can't ride the change).
 *   4. Deletes any other pending reset/invite tokens for this user.
 *
 * Notably: the server does NOT mint a new session on reset. The
 * legitimate user lands at /login after the success state, types
 * their new password, and gets routed into the app normally — same
 * flow they'd hit if they'd remembered the old password.
 *
 * Mirrors the AcceptInviteForm shape (password + confirm, MIN_LENGTH
 * guard, humanised errors) so users who hit either flow see a
 * consistent surface.
 *
 * Errors surfaced from the API:
 *   invalid_token   → "Reset link is invalid or expired."
 *   validation_*    → field-level message
 *   rate_limited    → "Too many attempts on this network…"
 *   network_error   → generic "couldn't reach the server"
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiPost } from "@/lib/api-client";

const MIN_PASSWORD_LENGTH = 12;

/* ── Nothing UI auth chrome (inlined per file — mirrors the reference
   ScreenAuth.dc.html "reset" variant in the migration kit). ───────── */

const FIELD_LABEL = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "1.5px",
  color: "var(--muted-fg)",
};

const INPUT = {
  fontFamily: "var(--font-mono)",
  fontSize: 14,
  letterSpacing: "4px",
  color: "var(--fg)",
  border: "1px solid var(--border-strong)",
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
  brandTitle: ["One", "new key"],
  brandBody:
    "Set a fresh password — long and unique. We hash it with argon2id and never see the plaintext.",
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

function Lead({ children, mb = 24 }) {
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

export function PasswordResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  if (!token) {
    return (
      <AuthShell {...BRAND} flowActive={2}>
        <Title size={28}>Missing reset token.</Title>
        <Lead mb={0}>
          Your reset link is incomplete. Open it again from the email you
          received, or request a new link.
        </Lead>
        <div
          style={{
            marginTop: 18,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--muted-fg)",
          }}
        >
          <Link
            href="/forgot-password"
            className="text-accent hover:underline"
            style={{ fontWeight: 600 }}
          >
            Request a new link
          </Link>
        </div>
      </AuthShell>
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
    const r = await apiPost("/auth/password/reset", { token, password });
    setSubmitting(false);
    if (!r.ok) {
      setError(humanise(r.error));
      return;
    }
    setDone(true);
    // Give the user a beat to read the success copy, then redirect
    // to /login. They'll sign in with the password they just set.
    setTimeout(() => router.replace("/login"), 1800);
  }

  if (done) {
    return (
      <AuthShell {...BRAND} flowActive={2}>
        <Title size={28}>Password updated.</Title>
        <Lead mb={4}>
          Redirecting you to sign-in. Use your new password to continue.
        </Lead>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--muted-fg)",
          }}
        >
          Not redirected?{" "}
          <Link
            href="/login"
            className="text-accent hover:underline"
            style={{ fontWeight: 600 }}
          >
            Go to sign-in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell {...BRAND} flowActive={2}>
      <Title>New password</Title>
      <Lead>
        Choose a new password. You&apos;ll be signed in on this device once
        it&apos;s set.
      </Lead>

      <form className="flex flex-col" onSubmit={handleSubmit}>
        <PasswordField
          label="New password"
          value={password}
          onChange={setPassword}
          autoFocus
          autoComplete="new-password"
          disabled={submitting}
          marginBottom={14}
        />
        <PasswordField
          label="Confirm password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          disabled={submitting}
          marginBottom={8}
        />
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--dim-fg)",
          }}
        >
          {MIN_PASSWORD_LENGTH}+ characters · argon2id hash
        </span>

        {error ? <div style={{ ...ERROR, marginTop: 10 }}>{error}</div> : null}

        <button
          type="submit"
          disabled={!password || !confirm || submitting}
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
            marginTop: 18,
            cursor: submitting ? "wait" : "pointer",
            opacity: password && confirm && !submitting ? 1 : 0.6,
          }}
        >
          {submitting ? "Updating…" : "Update password →"}
        </button>
      </form>
    </AuthShell>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoFocus,
  autoComplete,
  disabled,
  marginBottom,
}) {
  return (
    <label className="flex flex-col gap-[7px]" style={{ marginBottom }}>
      <span style={FIELD_LABEL}>{label}</span>
      <input
        type="password"
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required
        autoFocus={autoFocus}
        style={INPUT}
      />
    </label>
  );
}

function humanise(err) {
  if (!err) return "Something went wrong. Try again.";
  if (err.code === "invalid_token")
    return "Reset link is invalid or expired. Request a fresh one.";
  if (err.code === "rate_limited")
    return "Too many attempts on this network. Wait a few minutes and try again.";
  if (err.code === "validation_error")
    return err.message || "Check the fields and try again.";
  if (err.code === "network_error")
    return "Couldn't reach the server. Check your connection and try again.";
  return err.message || "Something went wrong. Try again.";
}

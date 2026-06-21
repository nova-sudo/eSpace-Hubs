"use client";

/**
 * Self-serve signup form.
 *
 *   email + password + display name + org signup code
 *     → POST /api/v1/auth/signup
 *     → server creates user with status="pending_admin", mints session
 *     → useSession() refresh picks up the new user
 *     → AuthGuard routes them through /totp-setup → /onboarding →
 *       /waiting-approval
 *
 * The signup code is the abuse-control gate. Admins distribute it
 * over secure channels — Slack/DM, not a public URL. The code lookup
 * is a single Mongo round-trip on the org doc.
 */

import { useState } from "react";
import Link from "next/link";
import { apiPost } from "@/lib/api-client";
import { setSession } from "./session-store.js";
import { clearAllUserScopedStorage } from "./clear-user-storage.js";

/* ── Nothing UI auth chrome (inlined per file — mirrors the reference
   ScreenSignup.dc.html in the migration kit). ─────────────────────── */

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
  padding: "10px 14px",
  background: "var(--card)",
  outline: "none",
  width: "100%",
};

const ERROR = {
  fontFamily: "var(--font-mono)",
  fontSize: 11.5,
  color: "var(--bad)",
};

function AuthShell({ brandTitle, brandBody, brandFooter, children }) {
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

/** Numbered onboarding steps for the brand-panel footer. */
function StepList({ steps }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {steps.map((s, i) => (
        <div
          key={i}
          style={{ display: "flex", alignItems: "center", gap: 10 }}
        >
          <span
            style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              border: "1px solid var(--brand-line)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-dot)",
              fontWeight: 700,
              fontSize: 9,
              color: "var(--brand-fg)",
            }}
          >
            {i + 1}
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "1px",
              color: "var(--brand-muted)",
            }}
          >
            {s}
          </span>
        </div>
      ))}
    </div>
  );
}

export function SignupForm({ onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [signupCode, setSignupCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await apiPost("/auth/signup", {
      email,
      password,
      displayName,
      signupCode: signupCode.trim(),
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Cross-user data leak fix: wipe any localStorage the previous
    // user left on this machine BEFORE handing the new user a session.
    // Without this, the new user inherits the prior user's goals /
    // snapshots / evidence / integrations etc., AND MigrateOnce
    // uploads that stale payload under the new user's account.
    clearAllUserScopedStorage();
    // Push the new user into the session store so AuthGuard /
    // useSession reflect the auth state without a /me round-trip.
    setSession({
      user: result.data?.user ?? null,
      loading: false,
      needsTotp: false,
      error: null,
    });
    onSuccess?.(result.data?.user);
  }

  const errorMessage = error ? humanizeError(error) : null;
  const canSubmit =
    !submitting && email && password && displayName && signupCode;

  return (
    <AuthShell
      brandTitle={["Start", "tracking", "what you", "ship"]}
      brandBody="You'll need a signup code from your admin. After signing up, your account waits for approval before you pick a hub."
      brandFooter={
        <StepList
          steps={[
            "Sign up with code",
            "Set up 2FA",
            "Await approval → pick hub",
          ]}
        />
      }
    >
      <h1
        style={{
          fontFamily: "var(--font-dot)",
          fontWeight: 900,
          fontSize: 34,
          letterSpacing: "1px",
          textTransform: "uppercase",
          color: "var(--fg)",
          margin: 0,
        }}
      >
        Create account
      </h1>
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 13.5,
          lineHeight: 1.5,
          color: "var(--muted-fg)",
          margin: "10px 0 26px",
        }}
      >
        Map your goals, connect your sources, and build review-ready evidence.
      </p>

      <form className="flex flex-col" onSubmit={handleSubmit}>
        <label className="flex flex-col gap-[7px]" style={{ marginBottom: 14 }}>
          <span style={FIELD_LABEL}>Display name</span>
          <input
            type="text"
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={submitting}
            autoFocus
            required
            minLength={1}
            maxLength={200}
            style={INPUT}
          />
        </label>

        <label className="flex flex-col gap-[7px]" style={{ marginBottom: 14 }}>
          <span style={FIELD_LABEL}>Email</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            required
            style={INPUT}
          />
        </label>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            marginBottom: 8,
          }}
        >
          <label className="flex flex-col gap-[7px]">
            <span style={FIELD_LABEL}>Password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              required
              minLength={8}
              maxLength={256}
              style={INPUT}
            />
          </label>
          <label className="flex flex-col gap-[7px]">
            <span style={FIELD_LABEL}>Signup code</span>
            <input
              type="text"
              value={signupCode}
              onChange={(e) => setSignupCode(e.target.value)}
              disabled={submitting}
              required
              minLength={4}
              maxLength={64}
              style={{
                ...INPUT,
                letterSpacing: "2px",
                textTransform: "uppercase",
                color: "var(--accent)",
                borderColor: "var(--accent)",
              }}
            />
          </label>
        </div>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--dim-fg)",
          }}
        >
          at least 8 characters
        </span>

        {errorMessage ? (
          <div style={{ ...ERROR, marginTop: 10 }}>{errorMessage}</div>
        ) : null}

        <button
          type="submit"
          disabled={!canSubmit}
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
            opacity: canSubmit ? 1 : 0.6,
          }}
        >
          {submitting ? "Creating account…" : "Create account →"}
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
        Already have an account?{" "}
        <Link
          href="/login"
          style={{
            color: "var(--accent)",
            fontWeight: 600,
            textDecoration: "underline",
          }}
        >
          Sign in
        </Link>
      </div>
    </AuthShell>
  );
}

function humanizeError(error) {
  if (!error) return null;
  switch (error.code) {
    case "invalid_signup_code":
      return "Signup code is invalid or expired. Ask your admin for a current one.";
    case "email_taken":
      return "An account with this email already exists. Try signing in instead.";
    case "rate_limited":
      return "Too many attempts. Wait a few minutes and try again.";
    case "network_error":
      return "Network error. Check your connection and try again.";
    default:
      return error.message || "Something went wrong. Please try again.";
  }
}

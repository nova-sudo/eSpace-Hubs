"use client";

/**
 * Invite-redemption form. Mounted at /accept-invite.
 *
 * Reads the token from the URL, captures a password + confirmation,
 * POSTs to /api/v1/auth/accept-invite. The server:
 *   1. Redeems the single-use token.
 *   2. argon2id-hashes the password + flips status to "active".
 *   3. Mints a session cookie (totpVerified: true) so the user lands
 *      logged-in without bouncing through /login again.
 *
 * Post-accept the AuthGuard sees `onboardingCompletedAt: null` and
 * routes the user to /onboarding for the M-OB 3-field form.
 *
 * Errors surfaced from the API:
 *   invalid_token   → "Invite link is invalid or expired."
 *   validation_*    → field-level message
 *   network_error   → generic "couldn't reach the server"
 */

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiPost } from "@/lib/api-client";
import { useSession } from "./use-session.js";
import { clearAllUserScopedStorage } from "./clear-user-storage.js";

const MIN_PASSWORD_LENGTH = 12;

/* ── Nothing UI auth chrome (inlined per file — mirrors the reference
   ScreenAuth.dc.html "invite" variant in the migration kit). ──────── */

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

/**
 * Two-panel auth shell: dark brand panel (dot-grid texture, dot-matrix
 * logo glyph, Doto wordmark headline, pill flow footer) beside the
 * centred form panel. Collapses to one column on narrow viewports.
 */
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

/** Flow chips in the brand-panel footer; the first `active`+1 read on. */
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

export function AcceptInviteForm({ onSuccess }) {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useSession();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!token) {
    return (
      <AuthShell
        brandTitle={["You're", "invited"]}
        brandBody="Activate your account, set up 2FA, and you're ready to start tracking what you ship."
        flow={["Invite", "Password", "Profile"]}
        flowActive={0}
      >
        <h1
          style={{
            fontFamily: "var(--font-dot)",
            fontWeight: 900,
            fontSize: 28,
            letterSpacing: "1px",
            textTransform: "uppercase",
            color: "var(--fg)",
            margin: 0,
          }}
        >
          Missing invite token.
        </h1>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 13.5,
            lineHeight: 1.5,
            color: "var(--muted-fg)",
            margin: "10px 0 0",
          }}
        >
          Your invite link is incomplete. Open it again from the email you
          received, or ask whoever invited you to resend.
        </p>
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
    const r = await apiPost("/auth/accept-invite", { token, password });
    setSubmitting(false);
    if (!r.ok) {
      setError(humanise(r.error));
      return;
    }

    // Cookie's already set by the API. Wipe any localStorage left by
    // a prior user on this browser (cross-user data leak fix) BEFORE
    // refreshing the session — `refresh()` flips `user` and the
    // *Sync effects mount; if localStorage still has the prior user's
    // data they'd race / upload it via MigrateOnce.
    clearAllUserScopedStorage();
    // Refresh the session store so useSession() sees the new user,
    // then bubble up.
    await refresh();
    onSuccess?.(r.data?.user);
    // Default destination: /onboarding. AuthGuard would route here
    // anyway since `onboardingCompletedAt` is null on the fresh user,
    // but doing it explicitly avoids one navigation tick.
    router.replace("/onboarding");
  }

  return (
    <AuthShell
      brandTitle={["You're", "invited"]}
      brandBody="Activate your account, set up 2FA, and you're ready to start tracking what you ship."
      flow={["Invite", "Password", "Profile"]}
      flowActive={1}
    >
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
        Activate account
      </h1>
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 13.5,
          lineHeight: 1.5,
          color: "var(--muted-fg)",
          margin: "10px 0 24px",
        }}
      >
        Pick a password. We'll set up your profile in the next step.
      </p>

      <form className="flex flex-col" onSubmit={handleSubmit}>
        <PasswordField
          label="Password"
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
          {MIN_PASSWORD_LENGTH}+ characters · stored as an argon2id hash
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
          {submitting ? "Activating…" : "Activate account →"}
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
    return "Invite link is invalid or expired. Ask for a new invite.";
  if (err.code === "validation_error")
    return err.message || "Check the fields and try again.";
  if (err.code === "network_error")
    return "Couldn't reach the server. Check your connection and try again.";
  return err.message || "Something went wrong. Try again.";
}

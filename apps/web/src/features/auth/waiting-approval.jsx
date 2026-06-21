"use client";

/**
 * Landing surface for self-sign-up users whose account is still
 * `status="pending_admin"`. AuthGuard routes them here after they've
 * finished TOTP setup + onboarding. Stays here until admin promotes
 * their status to `active` and grants them a role/hub.
 */

import { useSession } from "./use-session.js";

/* ── Nothing UI auth chrome (inlined per file — mirrors the reference
   ScreenAuth.dc.html "waiting" variant in the migration kit). ─────── */

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

export function WaitingApproval() {
  const { user, logout } = useSession();

  return (
    <AuthShell
      brandTitle={["Almost", "there"]}
      brandBody="Your account is built. An admin assigns your role and hub — usually within a business day."
      flow={["Sign up", "2FA", "Approval"]}
      flowActive={2}
    >
      <div style={{ textAlign: "center" }}>
        <div
          aria-hidden
          style={{
            width: 54,
            height: 54,
            margin: "0 auto 18px",
            borderRadius: "50%",
            border: "1px solid var(--border-strong)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--card)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-dot)",
              fontWeight: 900,
              fontSize: 22,
              color: "var(--accent)",
            }}
          >
            ⌛
          </span>
        </div>
        <h1
          style={{
            fontFamily: "var(--font-dot)",
            fontWeight: 900,
            fontSize: 26,
            letterSpacing: "1px",
            textTransform: "uppercase",
            color: "var(--fg)",
            margin: 0,
          }}
        >
          Pending approval
        </h1>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 13.5,
            lineHeight: 1.55,
            color: "var(--muted-fg)",
            margin: "12px auto 22px",
            maxWidth: 320,
          }}
        >
          Thanks{user?.displayName ? `, ${user.displayName}` : ""} — your
          account is set up. An admin needs to assign you a role and hub before
          you can start tracking.
        </p>
        <div
          style={{
            textAlign: "left",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--muted-fg)",
            border: "1px solid var(--border)",
            borderRadius: 7,
            background: "var(--card)",
            padding: "13px 15px",
            lineHeight: 1.9,
          }}
        >
          <div>email · {user?.email || "—"}</div>
          <div>
            status ·{" "}
            <span style={{ color: "var(--accent)" }}>pending_admin</span>
          </div>
          {user?.department && <div>department · {user.department}</div>}
        </div>
        <div style={{ marginTop: 18 }}>
          <button
            type="button"
            onClick={() => logout()}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.5px",
              textTransform: "uppercase",
              color: "var(--muted-fg)",
              background: "transparent",
              border: 0,
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </AuthShell>
  );
}

"use client";

/**
 * Landing surface for self-sign-up users whose account is still
 * `status="pending_admin"`. AuthGuard routes them here after they've
 * finished TOTP setup + onboarding. Stays here until admin promotes
 * their status to `active` and grants them a role/hub.
 */

import { useSession } from "./use-session.js";

export function WaitingApproval() {
  const { user, logout } = useSession();

  return (
    <div
      className="mx-auto flex max-w-lg flex-col items-center gap-5 py-16 text-center"
    >
      <div
        aria-hidden
        style={{
          fontSize: 40,
          lineHeight: 1,
          color: "var(--accent)",
        }}
      >
        ⌛
      </div>
      <h1
        className="font-semibold"
        style={{
          fontFamily: "var(--font-display, var(--font-inter-tight))",
          fontSize: 26,
          letterSpacing: "-0.5px",
        }}
      >
        Waiting for admin approval
      </h1>
      <p
        className="text-muted-fg"
        style={{ fontSize: 13.5, lineHeight: 1.55, maxWidth: 420 }}
      >
        Thanks{user?.displayName ? `, ${user.displayName}` : ""} — your
        account is set up. An admin needs to assign you a role and
        hub before you can start tracking. This usually happens within
        a business day; reach out to your admin if it's urgent.
      </p>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--muted-fg)",
          textAlign: "left",
          padding: "10px 14px",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sub, 3px)",
          background: "var(--card)",
        }}
      >
        <div>email · {user?.email || "—"}</div>
        <div>
          status · <span style={{ color: "var(--accent)" }}>pending_admin</span>
        </div>
        {user?.department && <div>department · {user.department}</div>}
      </div>
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
  );
}

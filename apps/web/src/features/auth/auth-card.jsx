"use client";

/**
 * Shared shell for every auth screen (login, signup, invite, reset,
 * TOTP, waiting-approval): a centered white card on the app canvas.
 * Local to features/auth — not a components/ui primitive, since it's
 * auth-specific chrome (design-system-v2.md section 7).
 */

import { LogoMark } from "@/components/shell/logo-mark";
import { Card } from "@/components/ui";

export function AuthCard({ title, lead, children, footer }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div
        className="w-full max-w-[420px] rounded-[var(--radius-xl)] bg-card p-8"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <div className="mb-7 flex items-center gap-2.5">
          <LogoMark size={28} />
          <span className="text-[17px] font-extrabold tracking-[-0.02em] text-fg">
            eSpace <span className="font-semibold text-muted-fg">Hubs</span>
          </span>
        </div>
        {title ? (
          <h1 className="text-[26px] font-extrabold tracking-[-0.03em] text-fg">
            {title}
          </h1>
        ) : null}
        {lead ? (
          <p className="mb-7 mt-2.5 text-[13.5px] leading-[1.5] text-muted-fg">
            {lead}
          </p>
        ) : (
          <div className="mb-7" />
        )}
        {children}
        {footer ? <div className="mt-6">{footer}</div> : null}
      </div>
    </main>
  );
}

/** Error banner recipe shared by every auth form. */
export function AuthError({ children }) {
  if (!children) return null;
  return (
    <Card tone="peach" radius="lg" padding={12} className="text-[13px]">
      {children}
    </Card>
  );
}

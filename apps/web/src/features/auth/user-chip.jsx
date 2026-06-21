"use client";

/**
 * Header chip showing the currently authenticated user, with a dropdown
 * that exposes Logout (and, in future, links to /settings/profile etc.).
 *
 * Resolution order for the displayed identity:
 *   1. The active server session (useSession()) — the post-M2 source
 *      of truth. Shows displayName + email.
 *   2. The integrations-derived `me` — legacy v0 path used when
 *      NEXT_PUBLIC_AUTH_REQUIRED=false and the user is operating in
 *      pure-localStorage mode. We don't show a logout for this case
 *      because there's no session to destroy.
 *   3. A "Sign in" link to /login when neither is available.
 *
 * Once the legacy proxy routes retire (M7.9c), the integrations
 * fallback can be dropped and this becomes session-only.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@radix-ui/react-dropdown-menu";
import { useSession } from "./use-session.js";
import { useIntegrations } from "@/features/integrations";
import { cn } from "@/lib/cn";

function initialsOf(name, fallbackEmail) {
  const source = name || fallbackEmail || "";
  if (!source) return "?";
  return (
    source
      .split(/[\s@.]+/)
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

export function UserChip() {
  const { user, loading, logout } = useSession();
  // Legacy integrations-derived identity — only consulted when there's
  // no session user. Keeps the header useful in pure-localStorage mode.
  const { me: legacyMe } = useIntegrations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // While the initial /auth/me round-trip is in flight, render a
  // placeholder so the chip doesn't pop in/out.
  if (loading && !user && !legacyMe) {
    return (
      <div
        className="flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-3 opacity-60"
        aria-hidden
      >
        <div
          className="grid h-6 w-6 place-items-center rounded-full bg-accent-dim text-fg"
          style={{ fontSize: 11 }}
        >
          ·
        </div>
        <div className="text-[12px] font-semibold text-muted-fg">…</div>
      </div>
    );
  }

  // Authenticated — full chip with dropdown.
  if (user) {
    const displayName = user.displayName || user.email;
    const initials = initialsOf(user.displayName, user.email);

    const onLogout = () => {
      startTransition(async () => {
        await logout();
        setOpen(false);
        router.replace("/login");
      });
    };

    return (
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-3 transition-colors hover:bg-accent-dim/60",
              open && "bg-accent-dim/60",
            )}
            aria-label={`Account menu for ${displayName}`}
          >
            <div
              className="grid h-6 w-6 place-items-center rounded-full font-bold"
              style={{
                fontSize: 9,
                fontFamily: "var(--font-mono)",
                color: "var(--muted-fg)",
                background: "var(--panel-2)",
                border: "1px solid var(--border-strong)",
                backgroundImage: "radial-gradient(var(--dot) 1px, transparent 1px)",
                backgroundSize: "4px 4px",
              }}
            >
              {initials}
            </div>
            <div
              className="text-[11px] uppercase tracking-[0.3px]"
              style={{ fontFamily: "var(--font-mono)", color: "var(--muted-fg)" }}
            >
              {displayName}
            </div>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={6}
          className="z-50 min-w-[220px] rounded-md border border-border bg-card p-1 shadow-lg"
          style={{
            background: "var(--card)",
            borderColor: "var(--border-strong)",
            fontFamily: "var(--font-mono)",
          }}
        >
          <DropdownMenuLabel className="px-2.5 py-2 text-[11px] uppercase tracking-[0.4px] text-dim-fg">
            Signed in as
          </DropdownMenuLabel>
          <div className="px-2.5 pb-2 text-[12px] leading-tight">
            <div className="font-semibold">{displayName}</div>
            <div className="text-muted-fg">{user.email}</div>
          </div>
          <DropdownMenuSeparator className="my-1 h-px bg-border" />
          <DropdownMenuItem
            disabled={isPending}
            onSelect={(e) => {
              // Keep the menu open while the async logout runs so the
              // disabled state is visible; we close manually after.
              e.preventDefault();
              onLogout();
            }}
            className={cn(
              "cursor-pointer rounded-sm px-2.5 py-2 text-[12px] outline-none",
              "hover:bg-accent-dim focus:bg-accent-dim",
              isPending && "cursor-wait opacity-60",
            )}
          >
            {isPending ? "Signing out…" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Legacy: integrations-derived identity, no session.
  if (legacyMe) {
    return (
      <div
        className="flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-3"
        title="Local-only mode — no server session"
      >
        <div
          className="grid h-6 w-6 place-items-center rounded-full bg-accent font-bold text-accent-on"
          style={{ fontSize: 11 }}
        >
          {legacyMe.initials || "?"}
        </div>
        <div className="text-[12px] font-semibold">{legacyMe.name}</div>
      </div>
    );
  }

  // Neither — show a sign-in entry point.
  return (
    <Link
      href="/login"
      className="flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-3 transition-colors hover:bg-accent-dim/60"
    >
      <div
        className="grid h-6 w-6 place-items-center rounded-full bg-accent-dim text-fg"
        style={{ fontSize: 11 }}
      >
        ?
      </div>
      <div className="text-[12px] font-semibold">Sign in</div>
    </Link>
  );
}

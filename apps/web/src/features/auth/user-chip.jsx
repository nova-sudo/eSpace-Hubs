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
import { ChevronDown } from "lucide-react";
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

function Avatar({ initials }) {
  return (
    <div className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-lav text-[11px] font-extrabold text-lav-ink">
      {initials}
    </div>
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
      <div className="flex h-[38px] items-center gap-2 rounded-[var(--radius-pill)] bg-card py-1 pl-1 pr-3 opacity-60" aria-hidden>
        <Avatar initials="…" />
        <div className="text-[13px] font-semibold text-muted-fg">…</div>
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
              "flex h-[38px] items-center gap-2 rounded-[var(--radius-pill)] bg-card pl-1 pr-3 transition-colors hover:bg-card-alt",
              open && "bg-card-alt",
            )}
            aria-label={`Account menu for ${displayName}`}
          >
            <Avatar initials={initials} />
            <span className="max-w-[140px] truncate text-[13px] font-semibold text-fg">
              {displayName}
            </span>
            <ChevronDown size={14} className="shrink-0 text-muted-fg" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          className="z-50 min-w-[220px] rounded-[var(--radius-xl)] bg-card p-2"
          style={{ boxShadow: "var(--shadow-float)" }}
        >
          <DropdownMenuLabel className="px-3 py-2 text-[12px] font-semibold text-muted-fg">
            Signed in as
          </DropdownMenuLabel>
          <div className="px-3 pb-2 text-[13px] leading-tight">
            <div className="font-bold text-fg">{displayName}</div>
            <div className="text-muted-fg">{user.email}</div>
          </div>
          <DropdownMenuSeparator className="my-1 h-px bg-line" />
          <DropdownMenuItem
            disabled={isPending}
            onSelect={(e) => {
              // Keep the menu open while the async logout runs so the
              // disabled state is visible; we close manually after.
              e.preventDefault();
              onLogout();
            }}
            className={cn(
              "cursor-pointer rounded-[var(--radius-lg)] px-3 py-2.5 text-[13px] font-semibold text-peach-ink outline-none hover:bg-card-alt",
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
        className="flex h-[38px] items-center gap-2 rounded-[var(--radius-pill)] bg-card pl-1 pr-3"
        title="Local-only mode — no server session"
      >
        <Avatar initials={legacyMe.initials || "?"} />
        <div className="text-[13px] font-semibold text-fg">{legacyMe.name}</div>
      </div>
    );
  }

  // Neither — show a sign-in entry point.
  return (
    <Link
      href="/login"
      className="flex h-[38px] items-center gap-2 rounded-[var(--radius-pill)] bg-card pl-1 pr-3 transition-colors hover:bg-card-alt"
    >
      <Avatar initials="?" />
      <div className="text-[13px] font-semibold text-fg">Sign in</div>
    </Link>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "./logo-mark";
import { AnalystActivator } from "@/features/analyst";
import { useIntegrations } from "@/features/integrations";
import { UserChip } from "@/features/auth";
import { cn } from "@/lib/cn";

const NAV = [
  ["Performance", "/"],
  ["Goals", "/goals"],
  ["Evidence", "/evidence"],
  ["Settings", "/settings"],
];

const VERSION = "v0.3.1";

export function Header() {
  const pathname = usePathname();
  const { connectedProviders } = useIntegrations();
  const isLive = connectedProviders.length > 0;

  return (
    <header
      className="sticky top-0 z-20 flex items-center justify-between border-b border-border px-10 py-3.5 backdrop-blur-xl"
      style={{ background: "rgba(241, 238, 230, 0.80)" }}
    >
      <div className="flex items-center gap-8">
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark />
          <div
            className="font-semibold"
            style={{ fontFamily: "var(--font-display)", fontSize: 18, letterSpacing: "-0.3px" }}
          >
            eSpace<span style={{ color: "var(--accent)" }}>/</span>DevHub
          </div>
          <span
            className="rounded-[4px] border border-border px-1.5 py-0.5 text-[10px] text-dim-fg"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {VERSION}
          </span>
        </Link>
        <nav className="flex gap-0.5" style={{ fontFamily: "var(--font-mono)" }}>
          {NAV.map(([label, href]) => {
            // Performance is the home tab — highlight it both on the
            // dashboard itself AND on its drill-down routes (/reviews,
            // /snapshots) so the user always knows which "section of the
            // app" they're in.
            const active =
              href === "/"
                ? pathname === "/" ||
                  pathname?.startsWith("/reviews") ||
                  pathname?.startsWith("/snapshots")
                : pathname?.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[12px] uppercase tracking-[0.4px] transition-colors",
                  active
                    ? "bg-accent-dim font-semibold text-fg"
                    : "text-muted-fg hover:bg-accent-dim/60",
                )}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center gap-3.5">
        <div
          className="flex items-center gap-1.5 text-[11px] text-muted-fg"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          <span
            className="block h-1.5 w-1.5 rounded-full"
            style={{
              background: isLive ? "var(--accent-2)" : "var(--dim-fg)",
              boxShadow: isLive ? "0 0 0 3px rgba(0,196,138,0.2)" : "none",
            }}
          />
          {isLive
            ? `LIVE · ${connectedProviders.length} integration${connectedProviders.length === 1 ? "" : "s"}`
            : "NOT CONNECTED"}
        </div>
        {/* Inverse-themed activator — opens the accent-ground analyst page. */}
        <AnalystActivator />
        {/* Session-aware chip with logout dropdown. Falls back to the
            integrations-derived identity in pure-localStorage mode. */}
        <UserChip />
      </div>
    </header>
  );
}

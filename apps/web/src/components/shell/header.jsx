"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "./logo-mark";
import { AnalystActivator } from "@/features/analyst";
import { useIntegrations } from "@/features/integrations";
import { UserChip } from "@/features/auth";
import { useActiveHub } from "@/features/hubs";
import { cn } from "@/lib/cn";

/**
 * Nav slots. Each entry maps to a hub `pages.<slot>` symbolic id;
 * the link href is computed from the active hub's prefix at render
 * time. Slots a hub doesn't expose (missing from its `pages` map)
 * are silently hidden.
 *
 * `dashboard` is the home of each hub. We highlight it on the
 * drill-down routes (reviews, snapshots) as well, mirroring the
 * pre-M10.2 behaviour for Dev Hub.
 */
const NAV_ITEMS = [
  { slot: "dashboard", label: "Performance", subpath: "" },
  { slot: "goals", label: "Goals", subpath: "/goals" },
  { slot: "evidence", label: "Evidence", subpath: "/evidence" },
  { slot: "settings", label: "Settings", subpath: "/settings" },
];

const VERSION = "v0.3.1";

export function Header() {
  const pathname = usePathname();
  const { connectedProviders } = useIntegrations();
  const isLive = connectedProviders.length > 0;
  const hub = useActiveHub();

  // Build the hub-prefixed link for each nav slot. If we don't have an
  // active hub (very brief loading window, or a top-level non-hub page
  // somehow renders the header), fall back to root — the redirect at
  // `/` will route the user back to their primary hub.
  const hubPrefix = hub ? `/${hub.id}` : "";

  return (
    <header
      className="sticky top-0 z-20 flex items-center justify-between border-b border-border px-10 py-3.5 backdrop-blur-xl"
      style={{ background: "rgba(241, 238, 230, 0.80)" }}
    >
      <div className="flex items-center gap-8">
        <Link href={hubPrefix || "/"} className="flex items-center gap-2.5">
          <LogoMark />
          <div
            className="font-semibold"
            style={{ fontFamily: "var(--font-display)", fontSize: 18, letterSpacing: "-0.3px" }}
          >
            eSpace<span style={{ color: "var(--accent)" }}>/</span>
            {hub?.label?.replace(/ Hub$/, "") ?? "DevHub"}
          </div>
          <span
            className="rounded-[4px] border border-border px-1.5 py-0.5 text-[10px] text-dim-fg"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {VERSION}
          </span>
        </Link>
        <nav className="flex gap-0.5" style={{ fontFamily: "var(--font-mono)" }}>
          {NAV_ITEMS.map((item) => {
            // Hide nav items the active hub doesn't expose. The dev
            // hub exposes all four; QA in M10.1 only exposes dashboard
            // / goals / evidence / settings so this is a no-op for
            // both current hubs, but ready for future hubs that
            // restrict their nav.
            if (hub && !hub.pages[item.slot]) return null;

            const href = `${hubPrefix}${item.subpath}` || "/";
            // Dashboard slot is the home tab — highlight on its
            // drill-downs too.
            const dashboardHome = `${hubPrefix}` || "/";
            const active =
              item.slot === "dashboard"
                ? pathname === dashboardHome ||
                  pathname?.startsWith(`${hubPrefix}/reviews`) ||
                  pathname?.startsWith(`${hubPrefix}/snapshots`)
                : pathname?.startsWith(href);
            return (
              <Link
                key={item.slot}
                href={href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[12px] uppercase tracking-[0.4px] transition-colors",
                  active
                    ? "bg-accent-dim font-semibold text-fg"
                    : "text-muted-fg hover:bg-accent-dim/60",
                )}
              >
                {item.label}
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

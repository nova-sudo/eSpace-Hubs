"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "./logo-mark";
import { AnalystActivator } from "@/features/analyst";
import { useIntegrations } from "@/features/integrations";
import { UserChip } from "@/features/auth";
import { useActiveHub, HubSwitcher } from "@/features/hubs";
import { cn } from "@/lib/cn";

/**
 * Slot → nav label + subpath. Drives the header's nav rendering.
 * The active hub's `pages` map decides which slots actually appear
 * (slots not in `hub.pages` are silently hidden).
 *
 * Order here is the order on screen. Admin slots come after the
 * generic ones; the admin hub's nav reads naturally as
 *   Dashboard · Hubs · Users · Audit · Settings
 *
 * Adding a slot to a hub now means: register it in the shared hub
 * registry (`pages.<slot>`) + add a route file + add an entry here
 * (or below in DASHBOARD_LABELS if it needs a hub-specific label).
 */
const NAV_ITEMS = [
  { slot: "dashboard", subpath: "" },
  { slot: "checkin", subpath: "/checkin" },
  { slot: "goals", subpath: "/goals" },
  { slot: "evidence", subpath: "/evidence" },
  { slot: "hub-config", subpath: "/hub-config" },
  { slot: "users", subpath: "/users" },
  { slot: "audit", subpath: "/audit" },
  { slot: "settings", subpath: "/settings" },
];

/**
 * Default labels per slot. Hub-specific overrides live in
 * HUB_SLOT_LABEL_OVERRIDES below — Dev's dashboard reads as
 * "Performance" (its longstanding name); admin's reads as "Overview";
 * everyone else falls back to "Dashboard".
 */
const DEFAULT_LABELS = {
  dashboard: "Dashboard",
  goals: "Goals",
  checkin: "Check-in",
  evidence: "Evidence",
  "hub-config": "Hubs",
  users: "Users",
  audit: "Audit",
  settings: "Settings",
  reviews: "Reviews",
  snapshots: "Snapshots",
};

const HUB_SLOT_LABEL_OVERRIDES = {
  dev: { dashboard: "Performance" },
  admin: { dashboard: "Overview" },
  qa: { dashboard: "Overview" },
  manager: { dashboard: "Team" },
};

function labelFor(slot, hubId) {
  const hubOverride = HUB_SLOT_LABEL_OVERRIDES[hubId];
  return (
    (hubOverride && hubOverride[slot]) ?? DEFAULT_LABELS[slot] ?? slot
  );
}

const VERSION = "v0.3.1";

export function Header() {
  const pathname = usePathname();
  const { connectedProviders } = useIntegrations();
  const isLive = connectedProviders.length > 0;
  const hub = useActiveHub();

  // Build the hub-prefixed link for each nav slot. Without an active
  // hub (brief loading window) fall back to root — the redirect at
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
        {/* Multi-hub users see a switcher chip here. Single-hub users
            see nothing (HubSwitcher self-hides when |hubs| <= 1). */}
        <HubSwitcher />
        <nav className="flex gap-0.5" style={{ fontFamily: "var(--font-mono)" }}>
          {NAV_ITEMS.map((item) => {
            if (hub && !hub.pages[item.slot]) return null;
            const label = labelFor(item.slot, hub?.id);
            const href = `${hubPrefix}${item.subpath}` || "/";
            // Dashboard slot is the home tab — highlight on its
            // drill-downs too (reviews/snapshots for Dev).
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
        {/* Session-aware chip with logout dropdown. */}
        <UserChip />
      </div>
    </header>
  );
}

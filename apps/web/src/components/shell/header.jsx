"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { LogoMark } from "./logo-mark";
import { ThemeToggle } from "./theme-toggle";
import { AnalystActivator } from "@/features/analyst";
import { UserChip } from "@/features/auth";
import { NotificationBell } from "@/features/notifications";
import { CompanionIndicator } from "@/features/companion";
import { useActiveHub, HubSwitcher } from "@/features/hubs";
import { openCommandPalette } from "@/features/command-palette";
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
  // Manager hub: per-report boards + the delegated-goal queue. Filtered
  // out on hubs whose `pages` map doesn't expose the slot (i.e. every
  // non-manager hub today).
  { slot: "employees", subpath: "/employees" },
  { slot: "delegated", subpath: "/delegated" },
  { slot: "approvals", subpath: "/approvals" },
  { slot: "tierpolicies", subpath: "/tier-policies" },
  // "checkin" retired — filling now lives on the Goals page via the per-widget
  // cadence stepper. The /checkin routes redirect to Goals for old bookmarks.
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
  evidence: "Evidence",
  "hub-config": "Hubs",
  users: "Users",
  audit: "Audit",
  settings: "Settings",
  employees: "Employees",
  delegated: "Delegated",
  approvals: "Approvals",
  tierpolicies: "Tier policies",
  reviews: "Reviews",
  snapshots: "Snapshots",
};

const HUB_SLOT_LABEL_OVERRIDES = {
  dev: { dashboard: "Intelligence" },
  admin: { dashboard: "Overview" },
  qa: { dashboard: "Overview" },
  manager: { dashboard: "Team" },
};

/**
 * Slots that stay registered in a hub's `pages` map (so the route still
 * resolves — e.g. the wordmark link keeps working, direct URLs still
 * work) but shouldn't clutter that hub's nav bar. Admin-only: its
 * "Overview" dashboard and "Hubs" (hub-config) tab are redundant in the
 * nav for admins, per product direction — QA also has a "dashboard"
 * slot labeled "Overview" and must keep its nav entry, so this is keyed
 * per-hub rather than per-slot.
 */
const HUB_HIDDEN_NAV_SLOTS = {
  admin: ["dashboard", "hub-config"],
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
  const hub = useActiveHub();
  // F10 — mobile nav. Below md the nav collapses behind a hamburger;
  // the panel closes on any route change so a tap never strands it open.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Build the hub-prefixed link for each nav slot. Without an active
  // hub (brief loading window) fall back to root — the redirect at
  // `/` will route the user back to their primary hub.
  const hubPrefix = hub ? `/${hub.id}` : "";

  // Resolved once — the desktop row and the mobile panel render the
  // same list, so slot visibility can never drift between the two.
  const navItems = NAV_ITEMS.flatMap((item) => {
    if (hub && !hub.pages[item.slot]) return [];
    if (hub && HUB_HIDDEN_NAV_SLOTS[hub.id]?.includes(item.slot)) return [];
    const label = labelFor(item.slot, hub?.id);
    const href = `${hubPrefix}${item.subpath}` || "/";
    // Dashboard slot is the home tab. It highlights only on the
    // home route itself now — the old reviews/snapshots drill-downs
    // are no longer part of the Intelligence home (Sprint-1 revamp).
    const dashboardHome = `${hubPrefix}` || "/";
    const active =
      item.slot === "dashboard"
        ? pathname === dashboardHome
        : pathname?.startsWith(href);
    return [{ slot: item.slot, label, href, active }];
  });

  return (
    <header
      className="sticky top-0 z-20 border-b border-border backdrop-blur-xl"
      style={{ background: "color-mix(in srgb, var(--bg) 82%, transparent)" }}
    >
      <div className="flex items-center justify-between px-4 sm:px-10 py-3.5">
        <div className="flex min-w-0 items-center gap-3 md:gap-8">
          {/* Hamburger — mobile only. Sits left of the wordmark, thumb reach. */}
          <button
            type="button"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-fg transition-colors hover:bg-accent-dim/60 md:hidden"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? <X className="h-4.5 w-4.5" /> : <Menu className="h-4.5 w-4.5" />}
          </button>
          <Link href={hubPrefix || "/"} className="flex min-w-0 items-center gap-2.5">
            <LogoMark />
            <div
              className="truncate font-semibold"
              style={{ fontFamily: "var(--font-display)", fontSize: 15, letterSpacing: "-0.2px" }}
            >
              eSpace<span style={{ color: "var(--accent)" }}>/</span>
              <span style={{ fontFamily: "var(--font-dot)", fontWeight: 700, letterSpacing: "1px" }}>
                {hub?.label?.replace(/ Hub$/, "") ?? "DevHub"}
              </span>
            </div>
            <span
              className="hidden rounded-[4px] border border-border px-1.5 py-0.5 text-[10px] text-dim-fg sm:inline"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {VERSION}
            </span>
          </Link>
          {/* Multi-hub users see a switcher chip here. Single-hub users
              see nothing (HubSwitcher self-hides when |hubs| <= 1). */}
          <div className="hidden md:block">
            <HubSwitcher />
          </div>
          <nav className="hidden gap-0.5 md:flex" style={{ fontFamily: "var(--font-mono)" }}>
            {navItems.map((item) => (
              <Link
                key={item.slot}
                href={item.href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[12px] uppercase tracking-[0.4px] transition-colors",
                  item.active
                    ? "bg-accent-dim font-semibold text-fg"
                    : "text-muted-fg hover:bg-accent-dim/60",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3.5">
          {/* #239: the command palette had NO visible trigger — a
              keyboard-only feature is invisible to anyone who doesn't
              already know it exists. Desktop-only chip; phones keep the
              header space (F10). */}
          <button
            type="button"
            onClick={() => openCommandPalette()}
            aria-label="Open command palette"
            className="hidden items-center gap-1 rounded-md border border-border px-2 py-1 text-dim-fg transition-colors hover:border-border-strong hover:text-muted-fg md:inline-flex"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
          >
            <span aria-hidden="true">⌘K</span>
          </button>
          {/* Light/dark switch — persists to localStorage('espace-theme'),
              which the no-flash script in layout.jsx reads on first paint. */}
          <ThemeToggle />
          {/* Inverse-themed activator — opens the accent-ground analyst page.
              Analysis is the dev goal-classification feature, so gate it on the
              hub actually exposing the analyst surface (dev only). Without this
              it leaked "Resume analysis" into manager/qa/admin. Hidden on
              phones — analysis is a desk journey; the header space isn't. */}
          {hub?.pages?.analyst ? (
            <div className="hidden sm:block">
              <AnalystActivator />
            </div>
          ) : null}
          {/* Companion-routing indicator — self-hides when the user has
              no companion. Engagement-agnostic; espace devs see nothing. */}
          <CompanionIndicator />
          {/* In-app inbox — manager grades (and, later, approvals). */}
          <NotificationBell />
          {/* Session-aware chip with logout dropdown. */}
          <UserChip />
        </div>
      </div>

      {/* Mobile nav panel — a plain vertical list under the bar. In-flow
          (not absolutely positioned) so it can never overlap content it
          doesn't push down; route changes close it via the effect above. */}
      {menuOpen ? (
        <nav
          className="flex flex-col gap-0.5 border-t border-border px-4 pb-3 pt-2 md:hidden"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          <div className="pb-1">
            <HubSwitcher />
          </div>
          {navItems.map((item) => (
            <Link
              key={item.slot}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-2.5 text-[13px] uppercase tracking-[0.4px] transition-colors",
                item.active
                  ? "bg-accent-dim font-semibold text-fg"
                  : "text-muted-fg hover:bg-accent-dim/60",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

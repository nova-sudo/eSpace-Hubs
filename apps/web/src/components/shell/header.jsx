"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Search } from "lucide-react";
import { LogoMark } from "./logo-mark";
import { ThemeToggle } from "./theme-toggle";
import { IconButton } from "@/components/ui";
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
 * "Intelligence"; admin's reads as "Overview"; everyone else falls
 * back to "Dashboard".
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
 * work) but shouldn't clutter that hub's nav bar.
 *
 * Empty on purpose. Admin used to hide its own "Overview" and "Hubs"
 * entries, which left hub configuration reachable only from a page that
 * was itself unreachable from the nav. The admin portal now draws its
 * own section rail (`hubs/admin/admin-shell.jsx`), and the top nav lists
 * the same sections, so the two agree. Keyed per-hub rather than
 * per-slot because QA has a "dashboard" slot of its own that must keep
 * its entry.
 */
const HUB_HIDDEN_NAV_SLOTS = {};

function labelFor(slot, hubId) {
  const hubOverride = HUB_SLOT_LABEL_OVERRIDES[hubId];
  return (
    (hubOverride && hubOverride[slot]) ?? DEFAULT_LABELS[slot] ?? slot
  );
}

function NavPill({ href, label, active, className }) {
  return (
    <Link
      href={href}
      className={cn(
        "whitespace-nowrap rounded-[var(--radius-pill)] px-4.5 py-2.5 text-[13.5px] font-semibold transition-colors",
        active ? "bg-ink text-ink-on" : "text-fg hover:bg-card",
        className,
      )}
    >
      {label}
    </Link>
  );
}

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
    <header className="sticky top-0 z-20 h-[72px] bg-bg">
      <div className="flex h-full items-center justify-between px-4 sm:px-10">
        <div className="flex min-w-0 items-center gap-3 md:gap-8">
          {/* Hamburger — mobile only. Sits left of the wordmark, thumb reach. */}
          <IconButton
            label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            className="md:hidden"
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </IconButton>
          <Link href={hubPrefix || "/"} className="flex min-w-0 items-center gap-2.5">
            <LogoMark />
            {/* Name treatment from the brand kit: "eSpace" at 800, "Hubs"
                at 600 in muted. */}
            <span className="truncate text-[17px] font-extrabold tracking-[-0.02em] text-fg">
              eSpace <span className="font-semibold text-muted-fg">Hubs</span>
            </span>
          </Link>
          {/* Multi-hub users see a switcher chip here. Single-hub users
              see nothing (HubSwitcher self-hides when |hubs| <= 1). */}
          <div className="hidden md:block">
            <HubSwitcher />
          </div>
          <nav className="hidden gap-1 md:flex">
            {navItems.map((item) => (
              <NavPill key={item.slot} href={item.href} label={item.label} active={item.active} />
            ))}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <IconButton label="Open command palette" onClick={() => openCommandPalette()}>
            <Search size={16} />
          </IconButton>
          {/* Light/dark switch — persists to localStorage('espace-theme'),
              which the no-flash script in layout.jsx reads on first paint. */}
          <ThemeToggle />
          {/* Opens the analyst overlay. Analysis is the dev goal-classification
              feature, so gate it on the hub actually exposing the analyst
              surface (dev only). Hidden on phones — analysis is a desk
              journey; the header space isn't. */}
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
        <nav className="flex flex-col gap-1 bg-bg px-4 pb-3 pt-1 md:hidden">
          <div className="pb-1">
            <HubSwitcher />
          </div>
          {navItems.map((item) => (
            <NavPill
              key={item.slot}
              href={item.href}
              label={item.label}
              active={item.active}
              className="w-full text-left"
            />
          ))}
        </nav>
      ) : null}
    </header>
  );
}

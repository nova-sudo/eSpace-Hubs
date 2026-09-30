"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Search } from "lucide-react";
import { LogoMark } from "./logo-mark";
import { ThemeToggle } from "./theme-toggle";
import { IconButton, PageWidth } from "@/components/ui";
import { AnalystActivator } from "@/features/analyst";
import { UserChip } from "@/features/auth";
import { NotificationBell } from "@/features/notifications";
import { CompanionIndicator } from "@/features/companion";
import { useActiveHub, HubSwitcher } from "@/features/hubs";
import { openCommandPalette } from "@/features/command-palette";
import { cn } from "@/lib/cn";
import { drillDownsFor } from "./drill-down-nav";
import { isNavHidden, TAB_ALIASES } from "./nav-visibility";

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
  { slot: "sharedgoals", subpath: "/shared-goals" },
  // "checkin" retired — filling now lives on the Goals page via the per-widget
  // cadence stepper. The /checkin routes redirect to Goals for old bookmarks.
  { slot: "goals", subpath: "/goals" },
  { slot: "evidence", subpath: "/evidence" },
  { slot: "hub-config", subpath: "/hub-config" },
  { slot: "users", subpath: "/users" },
  { slot: "orgchart", subpath: "/org-chart" },
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
  orgchart: "Org chart",
  audit: "Audit",
  settings: "Settings",
  employees: "Employees",
  delegated: "Delegated",
  approvals: "Approvals",
  tierpolicies: "Goals & policies",
  sharedgoals: "Shared with me",
  reviews: "Reviews",
  snapshots: "Snapshots",
};

const HUB_SLOT_LABEL_OVERRIDES = {
  dev: { dashboard: "Intelligence" },
  // Same names as the admin section rail (admin-shell.jsx) — one name per place.
  admin: { dashboard: "Overview", users: "Members", "hub-config": "Hubs & pages", audit: "Audit log" },
  qa: { dashboard: "Overview" },
  manager: { dashboard: "Team" },
};

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
      aria-current={active ? "page" : undefined}
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

const MOBILE_NAV_ID = "mobile-nav-panel";

export function Header() {
  const pathname = usePathname();
  const hub = useActiveHub();
  // F10 — mobile nav. Below md the nav collapses behind a hamburger;
  // the panel closes on any route change so a tap never strands it open.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef(null);
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);
  // Escape closes the panel and puts focus back on the hamburger (only when
  // focus was in the panel or on the button — never yanked from elsewhere).
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      const panel = document.getElementById(MOBILE_NAV_ID);
      const focusWasOurs =
        document.activeElement === menuButtonRef.current ||
        (panel && panel.contains(document.activeElement)) ||
        document.activeElement === document.body;
      setMenuOpen(false);
      if (focusWasOurs) menuButtonRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // Build the hub-prefixed link for each nav slot. Without an active
  // hub (brief loading window) fall back to root — the redirect at
  // `/` will route the user back to their primary hub.
  const hubPrefix = hub ? `/${hub.id}` : "";

  // Resolved once — the desktop row and the mobile panel render the
  // same list, so slot visibility can never drift between the two.
  const navItems = NAV_ITEMS.flatMap((item) => {
    if (hub && !hub.pages[item.slot]) return [];
    if (hub && isNavHidden(hub.id, item.slot)) return [];
    const label = labelFor(item.slot, hub?.id);
    const href = `${hubPrefix}${item.subpath}` || "/";
    // Dashboard slot is the home tab. It stays lit on its drill-downs
    // (Reviews log, Snapshots — the sub-nav under the page header) so a user two
    // clicks deep still sees which tab they're in. A drill-down that has
    // its own pill on this hub (manager's "Shared with me") lights that.
    const dashboardHome = `${hubPrefix}` || "/";
    const active =
      item.slot === "dashboard"
        ? pathname === dashboardHome ||
          drillDownsFor(hub).some(
            (d) =>
              pathname === `${hubPrefix}${d.path}` || pathname?.startsWith(`${hubPrefix}${d.path}/`),
          ) ||
          (TAB_ALIASES[hub?.id]?.dashboard || []).some(
            (sub) => pathname === `${hubPrefix}${sub}` || pathname?.startsWith(`${hubPrefix}${sub}/`),
          )
        : pathname?.startsWith(href);
    return [{ slot: item.slot, label, href, active }];
  });

  return (
    <header className="sticky top-0 z-20 h-[72px] bg-bg">
      {/* Same gutter + max width as <PageContainer>, so the bar's content
          edges line up with every page's content edges. */}
      <PageWidth className="h-full" innerClassName="flex h-full items-center justify-between">
        <div className="flex min-w-0 items-center gap-3 md:gap-8">
          {/* Hamburger — mobile only. Sits left of the wordmark, thumb reach. */}
          <IconButton
            ref={menuButtonRef}
            label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            aria-controls={MOBILE_NAV_ID}
            onClick={() => setMenuOpen((o) => !o)}
            className="md:hidden"
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </IconButton>
          <Link
            href={hubPrefix || "/"}
            aria-label="eSpace Hubs home"
            className="flex min-w-0 items-center gap-2.5"
          >
            <LogoMark />
            {/* Name treatment from the brand kit: "eSpace" at 800, "Hubs"
                at 600 in muted. */}
            <span className="hidden truncate text-[17px] font-extrabold tracking-[-0.02em] text-fg sm:inline">
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
      </PageWidth>

      {/* Mobile nav panel — a plain vertical list under the bar. In-flow
          (not absolutely positioned) so it can never overlap content it
          doesn't push down; route changes close it via the effect above. */}
      {menuOpen ? (
        <nav
          id={MOBILE_NAV_ID}
          aria-label="Main navigation"
          className="flex flex-col gap-1 bg-bg px-4 pb-3 pt-1 md:hidden"
        >
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

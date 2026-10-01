"use client";

/**
 * Home-tab sub-navigation — "Overview · Reviews log · Snapshots · Shared
 * with me" as a horizontal pill track under the page header.
 *
 * Replaces the old vertical side-slab (`sub-tabs-tag.jsx`), which set its
 * labels in vertical text and was pinned over the 16px phone gutter. This
 * one sits in the page flow, scrolls horizontally inside its own track at
 * phone width (the page itself never overflows) and is plain links with
 * `aria-current="page"` on the active one.
 *
 * Rendered by the home page (Intelligence) and by each drill-down page. It
 * self-hides when the active hub has no drill-downs, or when the current
 * route is neither the home nor one of the drill-downs (e.g. the manager
 * hub, where "Shared with me" has its own header pill).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useActiveHub, useHubLink } from "@/features/hubs";
import { isNavHidden } from "./nav-visibility";

/**
 * Drill-down slots, in display order. A slot only shows when the active
 * hub's registry exposes it. `hiddenNavOnly` entries show only on hubs
 * whose header hides that slot (nav-visibility.js) — elsewhere the header
 * pill is the entry point. The header also reads this list to keep the
 * home pill lit on a drill-down.
 */
export const DRILL_DOWNS = [
  { slot: "reviews", label: "Reviews log", path: "/reviews" },
  { slot: "snapshots", label: "Snapshots", path: "/snapshots" },
  { slot: "sharedgoals", label: "Shared with me", path: "/shared-goals", hiddenNavOnly: true },
];

/** The drill-downs this hub surfaces in the sub-nav (unprefixed paths). */
export function drillDownsFor(hub) {
  if (!hub) return [];
  return DRILL_DOWNS.filter(
    (d) => hub.pages?.[d.slot] && (!d.hiddenNavOnly || isNavHidden(hub.id, d.slot)),
  );
}

function isAt(pathname, href) {
  return pathname === href || Boolean(pathname?.startsWith(href + "/"));
}

export function DrillDownNav({ className }) {
  const pathname = usePathname();
  const hub = useActiveHub();
  const link = useHubLink();

  const drills = drillDownsFor(hub).map((d) => ({ ...d, href: link(d.path) }));
  if (!hub || drills.length === 0) return null;

  const homeHref = `/${hub.id}`;
  const onHome = pathname === homeHref;
  const onDrill = drills.some((d) => isAt(pathname, d.href));
  if (!onHome && !onDrill) return null;

  const items = [
    { key: "overview", label: "Overview", href: homeHref, active: onHome },
    ...drills.map((d) => ({ key: d.slot, label: d.label, href: d.href, active: isAt(pathname, d.href) })),
  ];

  return (
    // The outer box owns the horizontal scroll so a long track never widens
    // the page; it bleeds into the page gutter on phones so the last pill
    // can scroll fully into view.
    <nav
      aria-label="Intelligence sections"
      // Placement is fixed here, not per page: tucked directly under the
      // PageHeader (-mt-2 against its mb-7), the same on every page.
      className={cn("-mx-4 -mt-2 mb-7 max-w-[100vw] overflow-x-auto px-4 sm:mx-0 sm:px-0", className)}
    >
      <ul className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-card p-1">
        {items.map((it) => (
          <li key={it.key} className="shrink-0">
            <Link
              href={it.href}
              aria-current={it.active ? "page" : undefined}
              className={cn(
                "inline-flex items-center whitespace-nowrap rounded-[var(--radius-pill)] px-4 py-2 text-[13px] font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink",
                it.active ? "bg-ink text-ink-on" : "text-muted-fg hover:text-fg",
              )}
            >
              {it.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

"use client";

/**
 * Top-left drill-down badges — a vertical stack of always-visible
 * ticket-shaped links for the active top-level tab.
 *
 * The top-level tabs in the header (Performance · Goals · Evidence ·
 * Settings) each can have utility / drill-down routes that don't deserve
 * top-level chrome. We surface those here as a "slab" of badges pinned
 * to the left edge, just under the header:
 *
 *   Performance → Reviews log, Snapshots
 *   Goals        → (none → hidden)
 *   Evidence     → (none → hidden)
 *   Settings     → (none → hidden)
 *
 * Visual: each badge is a tall narrow accent-blue pill, rounded only on
 * the right (left edge is flush with the viewport). The label is set
 * vertically — `writing-mode: vertical-rl` so it reads top-to-bottom
 * down the strip. Stacked with a hairline gap so the slab reads as
 * "row of tabs" rather than one solid block. The badge matching the
 * current route is filled accent; the others are slightly translucent
 * so the stack also serves as a breadcrumb when on a drill-down.
 *
 * No expand/collapse — every internal tab is one click away at all
 * times. Hidden entirely on tabs that have no drill-downs.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/**
 * Map of top-level tab base path → array of drill-down routes.
 * Adding a sub-tab is one entry. Order is the visual display order.
 */
const SUB_TABS = {
  "/": [
    { label: "Reviews log", href: "/reviews" },
    { label: "Snapshots", href: "/snapshots" },
  ],
  // Other tabs have no drill-downs today. Add entries here when they do.
  // "/goals":     [],
  // "/evidence":  [],
  // "/settings":  [],
};

/**
 * Resolve which sub-tabs apply to the current pathname. We match against
 * the TOP-LEVEL tab key — when on /reviews or /snapshots the user is
 * still "in Performance", so we show the Performance drill-downs.
 */
function resolveSubTabs(pathname) {
  if (SUB_TABS[pathname]) return SUB_TABS[pathname];
  for (const [, items] of Object.entries(SUB_TABS)) {
    if (items.some((it) => pathname?.startsWith(it.href))) return items;
  }
  return null;
}

export function SubTabsTag() {
  const pathname = usePathname();
  const items = resolveSubTabs(pathname);
  if (!items || items.length === 0) return null;

  return (
    <div
      // Pinned just under the header (which is `sticky top-0` and ~57px tall).
      // z-15 lifts above the dashboard content but stays below the analyst
      // overlay (z-20+) and the command palette (z-100).
      className="fixed left-0 z-[15] flex flex-col items-start gap-[3px]"
      style={{ top: 76 }}
    >
      {items.map((it) => {
        const active =
          pathname === it.href || pathname?.startsWith(it.href + "/");
        return (
          <Badge key={it.href} href={it.href} label={it.label} active={active} />
        );
      })}
    </div>
  );
}

/**
 * One drill-down badge in the slab.
 *
 * Tall, narrow pill rounded only on the right side (left flush with the
 * viewport edge). Label set in `writing-mode: vertical-rl` so it reads
 * top-to-bottom down the strip — natural for a left-pinned tab.
 *
 * Hover nudges the badge ~3px right so it feels alive. `box-shadow` is
 * fine here (no clip-path), but we still use `filter: drop-shadow` so
 * the elevation matches the rest of the dashboard chrome.
 */
function Badge({ href, label, active }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex flex-col items-center gap-2 transition-all hover:translate-x-[3px]",
        // Rounded only on the right side — the left edge is flush against
        // the viewport, so left corners stay square.
        "rounded-r-md",
        // Narrow vertical strip with comfortable padding around the
        // rotated label. Fixed dimensions keep every badge identical so
        // the slab reads as a coherent group.
        "py-3.5",
        active ? "text-accent-on" : "text-accent-on/85 hover:text-accent-on",
      )}
      style={{
        background: active ? "var(--accent)" : "rgba(56, 38, 255, 0.82)",
        width: 30,
        minHeight: 132,
        filter: active
          ? "drop-shadow(0 4px 10px rgba(56, 38, 255, 0.32))"
          : "drop-shadow(0 1px 3px rgba(56, 38, 255, 0.18))",
        transition:
          "filter 200ms cubic-bezier(0.22, 0.61, 0.36, 1), transform 200ms cubic-bezier(0.22, 0.61, 0.36, 1), background 200ms cubic-bezier(0.22, 0.61, 0.36, 1)",
      }}
    >
      <span
        aria-hidden="true"
        className="block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{
          background: active ? "#fff" : "rgba(255,255,255,0.7)",
        }}
      />
      <span
        className="font-bold uppercase"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "1px",
          // Vertical text running top-to-bottom down the strip. `vertical-rl`
          // is the standard way to lay out vertical Latin text — letters
          // stay upright but the text "line" runs vertically. Reading
          // direction is top → bottom so the user's eye scans the slab
          // naturally from the top of the viewport.
          writingMode: "vertical-rl",
        }}
      >
        {label}
      </span>
    </Link>
  );
}

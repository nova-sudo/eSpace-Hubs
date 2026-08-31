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
import { useActiveHub, useHubLink } from "@/features/hubs";

/**
 * Drill-down slots surfaced as badges, in display order. A slot only
 * renders when the active hub's registry actually exposes it.
 *
 * HUB-AWARE ON PURPOSE: the original map keyed on bare paths ("/",
 * "/reviews") from the pre-hub era — under /[hub] routing the key never
 * matched the pathname and the hrefs would have 404'd, so this
 * component silently returned null forever and two fully-built pages
 * (Reviews log, Snapshots) had no entry point in the entire UI.
 */
const DRILL_DOWNS = [
  { slot: "reviews", label: "Reviews log", path: "/reviews" },
  { slot: "snapshots", label: "Snapshots", path: "/snapshots" },
];

export function SubTabsTag() {
  const pathname = usePathname();
  const hub = useActiveHub();
  const link = useHubLink();

  const items = DRILL_DOWNS.filter((d) => hub?.pages?.[d.slot]).map((d) => ({
    ...d,
    href: link(d.path),
  }));
  if (!hub || items.length === 0) return null;

  // Show on the hub's home (the dashboard the drill-downs belong to)
  // and on the drill-downs themselves (breadcrumb role) — not on
  // /goals, /evidence, /settings.
  const onHome = pathname === `/${hub.id}`;
  const onDrillDown = items.some(
    (it) => pathname === it.href || pathname?.startsWith(it.href + "/"),
  );
  if (!onHome && !onDrillDown) return null;

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
        // Accent-derived, not hard-coded Electric indigo — the badges
        // must follow the per-hub accent (dev green, qa orange, …).
        background: active
          ? "var(--accent)"
          : "color-mix(in srgb, var(--accent) 82%, transparent)",
        width: 30,
        minHeight: 132,
        filter: active
          ? "drop-shadow(0 4px 10px color-mix(in srgb, var(--accent) 32%, transparent))"
          : "drop-shadow(0 1px 3px color-mix(in srgb, var(--accent) 18%, transparent))",
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

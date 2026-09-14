"use client";

/**
 * Top-left drill-down badges — a vertical stack of always-visible
 * ticket-shaped links for the active top-level tab.
 *
 * The top-level tabs in the header (Intelligence / Team / Overview) each
 * can have utility / drill-down routes that don't deserve top-level
 * chrome. We surface those here as a "slab" of badges pinned to the left
 * edge, just under the header:
 *
 *   Dashboard → Reviews log, Snapshots
 *   Goals     → (none → hidden)
 *   Evidence  → (none → hidden)
 *   Settings  → (none → hidden)
 *
 * Visual: each badge is a tall narrow pill, rounded only on the right
 * (left edge is flush with the viewport). The label is set vertically —
 * `writing-mode: vertical-rl` so it reads top-to-bottom down the strip.
 * Stacked with a gap so the slab reads as "row of tabs" rather than one
 * solid block. The badge matching the current route is filled ink; the
 * others sit on `card-alt` so the stack also serves as a breadcrumb when
 * on a drill-down.
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
      // Pinned just under the header (which is `sticky top-0` and 72px tall).
      // z-15 lifts above the dashboard content but stays below the analyst
      // overlay (z-20+) and the command palette (z-100).
      className="fixed left-0 z-[15] flex flex-col items-start gap-1.5"
      style={{ top: 80 }}
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
 * Hover nudges the badge a few px right so it feels alive.
 */
function Badge({ href, label, active }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex flex-col items-center gap-2 rounded-r-[var(--radius-lg)] py-3.5 transition-all hover:translate-x-[3px]",
        // Narrow vertical strip with comfortable padding around the
        // rotated label. Fixed dimensions keep every badge identical so
        // the slab reads as a coherent group.
        active ? "bg-ink text-ink-on" : "bg-card-alt text-muted-fg hover:text-fg",
      )}
      style={{ width: 30, minHeight: 132 }}
    >
      <span
        aria-hidden="true"
        className={cn("block h-1.5 w-1.5 shrink-0 rounded-full", active ? "bg-ink-on" : "bg-current")}
      />
      <span
        className="text-[11px] font-semibold"
        style={{ writingMode: "vertical-rl" }}
      >
        {label}
      </span>
    </Link>
  );
}

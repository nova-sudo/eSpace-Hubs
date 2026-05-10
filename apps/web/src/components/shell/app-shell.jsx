"use client";

import { Grain } from "@/components/ui";
import { AnalystPage, AnalystProvider, useAnalyst } from "@/features/analyst";
import { CommandPalette, useGlobalShortcuts } from "@/features/command-palette";
import { DemoBanner, useDemoMode } from "@/features/demo-mode";
import { BackfillBanner, useAutoSnapshot } from "@/features/snapshots";
import { Header } from "./header";
import { Footer } from "./footer";
import { SubTabsTag } from "./sub-tabs-tag";

/**
 * Pixel height of the demo banner when it's rendered. Used to offset
 * fixed-positioned chrome (the bookmark slab) and the scroll-snap
 * section heights so they don't slip under the banner or overflow
 * past the viewport.
 *
 * Kept in sync manually with `demo-banner.jsx`'s actual rendered height
 * (py-1.5 = 12 + ~18-20 content). If you tweak the banner padding,
 * tweak this too.
 */
const DEMO_BANNER_H = 32;

/**
 * Top-level page chrome — grain overlay, sticky header, optional footer.
 *
 * Hosts the AI Analyst overlay: when the header's activator flips the
 * shared `useAnalyst().open`, the dashboard view translates left and the
 * `<AnalystPage />` (fixed sibling) translates in from the right.
 *
 * Chat still exists as a secondary mode inside the analyst page — see
 * `@/features/analyst/analyst-chat-mode.jsx`. The old standalone
 * ChatProvider / ChatPage / ChatActivator remain in `@/features/chat` for
 * direct use if needed, but the primary experience is now goal analysis.
 */
export function AppShell({ children, hideFooter = false }) {
  return (
    <AnalystProvider>
      <AppShellInner hideFooter={hideFooter}>{children}</AppShellInner>
    </AnalystProvider>
  );
}

function AppShellInner({ children, hideFooter }) {
  const { open } = useAnalyst();
  // Hook the global keyboard shortcuts (1-6, j/k, g+x chords). The palette's
  // own ⌘K / ? listener lives inside the palette component.
  useGlobalShortcuts();
  // Auto-snapshotter — captures one snapshot per completed Sun → Thu
  // work-week. Idempotent: if the most recent completed week already
  // has a snapshot (manual or auto), this is a no-op. Lives at the
  // shell level so it fires on any page visit, not just the dashboard.
  useAutoSnapshot();
  const demo = useDemoMode();
  // Single CSS variable broadcast on the swipe wrapper so any
  // descendant (sections, fixed-position bookmark, etc.) can subtract
  // banner height from its viewport-anchored math.
  const bannerH = demo ? DEMO_BANNER_H : 0;
  return (
    <>
      <Grain opacity={0.55} blend="multiply" />
      {/* Everything that should swipe off left when the analyst opens
          lives inside this wrapper. We transform the wrapper rather than
          the `body` so sticky headers inside continue to work (sticky
          needs a scrolling ancestor, and `transform` on `body` would
          break that). */}
      <div
        className="relative z-[2]"
        aria-hidden={open ? "true" : undefined}
        inert={open ? "" : undefined}
        style={{
          transform: open ? "translateX(-100%)" : "translateX(0)",
          transition: "transform 320ms cubic-bezier(0.22, 0.61, 0.36, 1)",
          willChange: "transform",
          // Broadcast the demo banner height to descendants. Section
          // heights and the fixed bookmark slab consume this so the
          // viewport math stays correct.
          "--demo-banner-h": `${bannerH}px`,
        }}
      >
        <DemoBanner />
        {/* Backfill banner — sits between demo banner and header.
            Self-hides when the snapshot store has every completed
            Sun → Thu week of the current year already covered. */}
        <BackfillBanner />
        <Header />
        {/* Side bookmark for drill-down routes within the active top-level
            tab (Performance → Reviews log + Snapshots). Self-hides on
            tabs that have no drill-downs, so it doesn't render orphan
            UI on Goals / Evidence / Settings. Lives INSIDE the swipe
            wrapper so the analyst overlay slides cleanly over it. */}
        <SubTabsTag />
        <div>{children}</div>
        {hideFooter ? null : (
          <div className="px-10">
            <Footer />
          </div>
        )}
      </div>
      <AnalystPage />
      {/* Mounted last so it floats above the analyst overlay; uses fixed
          positioning + z-100 to clear every other layer including the grain. */}
      <CommandPalette />
    </>
  );
}

"use client";

import { ScrollProvider, useActiveSection } from "./use-active-section";
import { SectionRail } from "./section-rail";
import { SectionCounter } from "./section-counter";
import { setDashboardView } from "../use-dashboard-view";

/**
 * Full-viewport scroll-snap root. Mounts below the 57px sticky header so the
 * header is never scrolled; sections inside this container are what snap.
 *
 * Layout:
 *   - height: calc(100vh - 57px) — header is fixed-height above
 *   - scroll-snap-type: y mandatory — every scroll lands on a section
 *   - webkit scrollbar hidden via inline <style>; Firefox uses scrollbar-width
 *
 * The rail + counter sit as fixed-position overlays, outside the snap
 * container so they don't participate in layout.
 */
export function ScrollShell({ children }) {
  return (
    <ScrollProvider>
      <ScrollBody>{children}</ScrollBody>
      <SectionRail />
      <SectionCounter />
      <CompactModeToggle />
    </ScrollProvider>
  );
}

function CompactModeToggle() {
  return (
    <button
      aria-label="Switch to compact daily-use view"
      onClick={() => setDashboardView("compact")}
      style={{
        position: "fixed",
        left: 18,
        bottom: 18,
        zIndex: 30,
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.6px",
        color: "var(--muted-fg)",
        background: "rgba(255,255,255,0.7)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sub)",
        padding: "5px 8px",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        cursor: "pointer",
        transition: "color 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--fg)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted-fg)")}
    >
      ⊟ Compact view
    </button>
  );
}

function ScrollBody({ children }) {
  const { scrollRootRef } = useActiveSection();
  return (
    <>
      {/* Hide the scrollbar without disabling scrolling. Lives inline so it
          doesn't leak into globals.css (which is shared with non-dashboard
          pages where default scrollbars are fine). */}
      <style>{`
        .devhub-scroll-root { scrollbar-width: none; -ms-overflow-style: none; }
        .devhub-scroll-root::-webkit-scrollbar { display: none; width: 0; height: 0; }
      `}</style>
      <main
        ref={scrollRootRef}
        id="scroll-root"
        className="devhub-scroll-root relative z-[2]"
        style={{
          height: "calc(100vh - var(--header-height))",
          overflowY: "scroll",
          scrollSnapType: "y mandatory",
          scrollBehavior: "smooth",
        }}
      >
        {children}
      </main>
    </>
  );
}

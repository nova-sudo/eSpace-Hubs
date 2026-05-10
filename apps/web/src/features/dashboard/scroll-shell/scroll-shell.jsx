"use client";

import { ScrollProvider, useActiveSection } from "./use-active-section";
import { SectionRail } from "./section-rail";
import { SectionCounter } from "./section-counter";

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
    </ScrollProvider>
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
          // Banner-aware viewport math — see app-shell.jsx for the var.
          height: "calc(100vh - 57px - var(--demo-banner-h, 0px))",
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

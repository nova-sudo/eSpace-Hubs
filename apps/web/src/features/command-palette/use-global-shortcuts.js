"use client";

/**
 * Global keyboard shortcuts.
 *
 * Hooked at the AppShell level so they work everywhere except inside text
 * inputs (we sniff `e.target.tagName` and bail). Cmd+K / `?` are owned by
 * the palette itself; this module covers the rest:
 *
 *   1..N   Jump to section N within the current tab (Performance or Goals)
 *   j / k  Next / previous section (only on / or /goals)
 *   g p    Go to Performance (the dashboard)
 *   g g    Go to Goals
 *   g e    Go to Evidence
 *   g t    Go to Settings   (cog/tweak)
 *   g r    Go to Reviews log
 *   g s    Go to Snapshots
 *   g d    Legacy alias → Performance (was "go to dashboard")
 *   esc    Close any open dialog (palette handles its own; this is a
 *          fallback that blurs the active element)
 *
 * The `g`-prefix is a chord: pressing `g` arms a 1.2s window during which
 * a follow-up letter completes the action. Vim users will recognise the
 * pattern. The chord state never escapes this hook.
 */

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useHubLink } from "@/features/hubs";

const CHORD_TIMEOUT_MS = 1200;

// Hub-relative chord destinations. Resolved through useHubLink() at
// fire time so the same chord (`g g` → Goals) targets the active hub
// whichever one it is.
const CHORD_NAV = {
  // Top-level tabs first (mirrors the header order).
  p: "",          // Performance — bare hub root
  g: "/goals",    // Goals — `g g` (double tap) goes to Goals
  e: "/evidence",
  t: "/settings",
  // Utility / drill-down routes.
  r: "/reviews",
  s: "/snapshots",
  // Legacy: `g d` used to mean "go to dashboard" pre-tab-split. Keep it
  // working so muscle memory survives.
  d: "",
};

export function useGlobalShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const link = useHubLink();
  const chordRef = useRef({ key: null, expiresAt: 0 });

  useEffect(() => {
    function isTyping(target) {
      if (!target) return false;
      const tag = target.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target.isContentEditable
      );
    }

    function clearChord() {
      chordRef.current = { key: null, expiresAt: 0 };
    }

    function onKey(e) {
      // Don't steal keys from text fields.
      if (isTyping(e.target)) return;
      // Modifier-bearing keys: leave them to other handlers (browser, palette).
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const now = Date.now();
      const chord = chordRef.current;
      const inChord = chord.key && now < chord.expiresAt;

      // ── Chord follow-up ──────────────────────────────────────────────
      if (inChord && chord.key === "g") {
        const sub = CHORD_NAV[e.key.toLowerCase()];
        clearChord();
        if (sub !== undefined) {
          const dest = link(sub);
          if (dest && dest !== pathname) {
            e.preventDefault();
            router.push(dest);
          }
          return;
        }
        // Unknown follow-up — just drop the chord and let the key through.
        return;
      }

      // ── Chord starter ────────────────────────────────────────────────
      if (e.key === "g") {
        chordRef.current = { key: "g", expiresAt: now + CHORD_TIMEOUT_MS };
        e.preventDefault();
        return;
      }

      // ── Single-key shortcuts ────────────────────────────────────────
      // Section jumps + j/k only meaningful on routes that own a
      // scroll-shell — Performance (/) and Goals (/goals). Other routes
      // don't have data-section-id targets to jump between.
      if (pathname === link("") || pathname?.startsWith(link("/goals"))) {
        if (/^[1-9]$/.test(e.key)) {
          const idx = Number(e.key) - 1;
          const sections = document.querySelectorAll("[data-section-id]");
          const node = sections[idx];
          if (node) {
            e.preventDefault();
            node.scrollIntoView({ behavior: "smooth", block: "start" });
          }
          return;
        }
        if (e.key === "j" || e.key === "k") {
          const sections = Array.from(
            document.querySelectorAll("[data-section-id]"),
          );
          if (sections.length === 0) return;
          // Find the closest section to the viewport top.
          const tops = sections.map((n) => n.getBoundingClientRect().top);
          let activeIdx = 0;
          // The "active" section is the one whose top is closest to (but
          // not far above) the current scroll position. Tolerate a small
          // negative offset for sections currently scrolled-up.
          for (let i = 0; i < tops.length; i++) {
            if (tops[i] <= 100) activeIdx = i;
          }
          const nextIdx =
            e.key === "j"
              ? Math.min(sections.length - 1, activeIdx + 1)
              : Math.max(0, activeIdx - 1);
          if (nextIdx !== activeIdx) {
            e.preventDefault();
            sections[nextIdx].scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          }
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [pathname, router, link]);
}

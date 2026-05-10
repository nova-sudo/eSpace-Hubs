"use client";

/**
 * Top-of-app banner shown while demo mode is on.
 *
 * Two jobs:
 *   - Make it visually impossible to mistake demo data for real data.
 *   - Offer one-click "Turn off" so the user can drop back to real
 *     integrations without hunting through Settings.
 *
 * Hidden when demo mode is off — pure no-op render.
 */

import { setDemoMode, useDemoMode } from "./demo-mode-store";

export function DemoBanner() {
  const demo = useDemoMode();
  if (!demo) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-between gap-3 px-10 py-1.5"
      style={{
        background: "var(--accent)",
        color: "var(--accent-on)",
        // Tiny stripe so it reads as "system bar", not "tile".
        borderBottom: "1px solid rgba(255,255,255,0.18)",
      }}
    >
      <div className="flex items-baseline gap-2.5">
        <span
          className="font-bold uppercase tracking-[0.6px]"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
        >
          Demo mode
        </span>
        <span
          style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
        >
          Synthetic dataset · 14 PRs · 4 reviewers · TTFR / ATTNR / idle
          spread to fill the spectrum
        </span>
      </div>
      <button
        type="button"
        onClick={() => setDemoMode(false)}
        className="cursor-pointer rounded-[var(--radius-sub)] border border-[rgba(255,255,255,0.4)] px-2.5 py-1 hover:bg-[rgba(255,255,255,0.12)]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.4px",
          textTransform: "uppercase",
        }}
      >
        Turn off ↗
      </button>
    </div>
  );
}

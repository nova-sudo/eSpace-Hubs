"use client";

import { useActiveSection } from "./use-active-section";

/**
 * Tiny bottom-right counter (e.g. "02 / 04") — the current section in accent,
 * the total in muted-fg. Updates with the rail, driven by the shared
 * `useActiveSection` context.
 */
export function SectionCounter() {
  const { sections, active } = useActiveSection();
  if (sections.length === 0) return null;
  const idx = Math.max(
    0,
    sections.findIndex((s) => s.id === active),
  );
  const current = String(idx + 1).padStart(2, "0");
  const total = String(sections.length).padStart(2, "0");
  return (
    <div
      aria-hidden="true"
      className="no-print"
      style={{
        position: "fixed",
        right: 18,
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
      }}
    >
      <span style={{ color: "var(--accent)", fontWeight: 700 }}>{current}</span>
      {" / "}
      {total}
    </div>
  );
}

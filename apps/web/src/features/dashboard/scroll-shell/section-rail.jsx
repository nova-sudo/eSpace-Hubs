"use client";

import { useActiveSection } from "./use-active-section";

/**
 * Fixed vertical rail on the right edge. One 6×6 bubble per section; active
 * bubble grows to 8×8 with an accent halo, hovered bubble grows to 9×9.
 * Tooltip slides in from the right with a `#label` glyph.
 */
export function SectionRail() {
  const { sections, active, scrollTo } = useActiveSection();
  if (sections.length === 0) return null;

  return (
    <>
      {/* Hover-grow on the bubble is handled via a scoped CSS rule rather
          than inline style so it can transition smoothly with :hover. */}
      <style>{`
        .devhub-rail-item:hover [data-bubble] {
          width: 9px !important;
          height: 9px !important;
        }
        .devhub-rail-item:hover [data-bubble]:not([data-active="true"]) {
          background: var(--muted-fg) !important;
        }
        .devhub-rail-item:hover [data-tip],
        .devhub-rail-item[data-active="true"] [data-tip] {
          opacity: 1 !important;
          transform: translateY(-50%) translateX(0) !important;
        }
      `}</style>
      <nav
        aria-label="Dashboard sections"
        className="no-print"
        style={{
          position: "fixed",
          top: "50%",
          right: 18,
          transform: "translateY(-50%)",
          zIndex: 30,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          padding: "14px 10px",
          background: "rgba(255,255,255,0.55)",
          border: "1px solid var(--border)",
          borderRadius: 999,
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
        }}
      >
        {/* subtle connecting rule behind the bubbles */}
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 14,
            bottom: 14,
            left: "50%",
            width: 1,
            transform: "translateX(-0.5px)",
            background: "var(--border)",
            zIndex: -1,
          }}
        />
        {sections.map((s) => {
          const isActive = s.id === active;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => scrollTo(s.id)}
              aria-label={`#${s.label}`}
              aria-current={isActive ? "true" : undefined}
              data-active={isActive ? "true" : "false"}
              className="devhub-rail-item relative flex h-[14px] w-[14px] cursor-pointer items-center justify-center border-0 bg-transparent p-0"
            >
              <span
                data-bubble
                data-active={isActive ? "true" : "false"}
                aria-hidden="true"
                className="rounded-full"
                style={{
                  width: isActive ? 8 : 6,
                  height: isActive ? 8 : 6,
                  background: isActive
                    ? "var(--accent)"
                    : "var(--border-strong)",
                  boxShadow: isActive ? "0 0 0 3px var(--accent-dim)" : "none",
                  transition:
                    "width .2s ease, height .2s ease, background .2s ease, box-shadow .2s ease",
                }}
              />
              <span
                data-tip
                aria-hidden="true"
                className="pointer-events-none absolute right-[22px] top-1/2 whitespace-nowrap rounded-[var(--radius-sub)] border bg-card px-2.5 py-[5px]"
                style={{
                  transform: "translateY(-50%) translateX(4px)",
                  opacity: 0,
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: "0.6px",
                  textTransform: "uppercase",
                  color: "var(--fg)",
                  borderColor: "var(--border-strong)",
                  boxShadow: "0 2px 8px rgba(10,11,22,0.06)",
                  transition: "opacity .15s ease, transform .15s ease",
                }}
              >
                <span style={{ color: "var(--accent)" }}>#</span>
                {s.label}
                {/* arrow pointer on the right edge */}
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    right: -4,
                    top: "50%",
                    width: 6,
                    height: 6,
                    background: "var(--card)",
                    borderRight: "1px solid var(--border-strong)",
                    borderTop: "1px solid var(--border-strong)",
                    transform: "translateY(-50%) rotate(45deg)",
                  }}
                />
              </span>
            </button>
          );
        })}
      </nav>
    </>
  );
}

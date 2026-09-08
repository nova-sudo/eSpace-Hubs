"use client";

/**
 * A normal-flow page section with the dashboard's section header look
 * (italic-serif accent number · title · mono subtitle). Replaces the
 * retired scroll-shell `Section`, which locked every section to one
 * viewport height with `overflow: hidden` — content taller than the
 * screen was clipped forever (WCAG 1.4.10 reflow; audit #235/#239).
 * Keeps `data-section-id` so the command palette's "jump to section"
 * still finds it.
 */
export function PlainSection({ id, number, title, subtitle, children, className = "" }) {
  return (
    <section
      id={id}
      data-section-id={id}
      aria-labelledby={title ? `${id}-title` : undefined}
      className={`relative z-[2] flex flex-col gap-[18px] px-4 pb-11 pt-9 sm:px-10 ${className}`}
    >
      {title || number ? (
        <header className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 border-b border-border pb-2.5">
          <div className="flex items-baseline gap-3.5">
            {number ? (
              <span
                className="text-accent"
                style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 22, fontWeight: 500, lineHeight: 1 }}
              >
                {number}
              </span>
            ) : null}
            {title ? (
              <h2
                id={`${id}-title`}
                className="m-0 font-semibold"
                style={{ fontFamily: "var(--font-display)", fontSize: 22, letterSpacing: "-0.5px", lineHeight: 1.2 }}
              >
                {title}
              </h2>
            ) : null}
          </div>
          {subtitle ? (
            <span
              className="uppercase text-muted-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: "0.6px" }}
            >
              {subtitle}
            </span>
          ) : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

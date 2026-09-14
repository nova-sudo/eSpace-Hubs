"use client";

/**
 * A normal-flow page section with the shared section-header look
 * (Label number · title · Label subtitle). Replaces the retired
 * scroll-shell `Section`, which locked every section to one viewport
 * height with `overflow: hidden` — content taller than the screen was
 * clipped forever (WCAG 1.4.10 reflow; audit #235/#239). Keeps
 * `data-section-id` so the command palette's "jump to section" still
 * finds it.
 */
import { Label } from "@/components/ui";

export function PlainSection({ id, number, title, subtitle, children, className = "" }) {
  return (
    <section
      id={id}
      data-section-id={id}
      aria-labelledby={title ? `${id}-title` : undefined}
      className={`relative z-[2] flex flex-col gap-[18px] px-4 pb-11 pt-9 sm:px-10 ${className}`}
    >
      {title || number ? (
        <header className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
          <div className="flex items-baseline gap-3">
            {number ? <Label>{number}</Label> : null}
            {title ? (
              <h2 id={`${id}-title`} className="m-0 text-[18px] font-bold tracking-[-0.01em] text-fg">
                {title}
              </h2>
            ) : null}
          </div>
          {subtitle ? <Label>{subtitle}</Label> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

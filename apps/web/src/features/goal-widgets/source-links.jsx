"use client";

import { ExternalLink } from "lucide-react";

/**
 * "Check on GitHub ↗" and friends — the widget-footer row of links to the
 * provider page that shows exactly what a tile counted. Renders nothing
 * when there is nothing to link, so callers pass whatever they have.
 *
 * `links`: [{ label, href }] — a null href is skipped.
 */
export function SourceLinks({ links }) {
  const list = (Array.isArray(links) ? links : []).filter((l) => l && typeof l.href === "string" && l.href);
  if (list.length === 0) return null;
  return (
    <>
      {list.map((l) => (
        <a
          key={l.href}
          href={l.href}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-pill)] px-2.5 text-[12.5px] font-semibold text-fg hover:bg-card-alt"
          title={l.title || l.label}
        >
          {l.label}
          <ExternalLink size={12} className="text-muted-fg" />
        </a>
      ))}
    </>
  );
}

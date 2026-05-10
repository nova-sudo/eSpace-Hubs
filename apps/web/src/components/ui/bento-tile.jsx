import { cn } from "@/lib/cn";
import { MonoLabel } from "./mono-label";

/**
 * Bento-grid tile — the basic dashboard building block.
 *
 * The dashboard grid is 12-col with a fixed `gridAutoRows` (density-driven).
 * Callers pass `col="span 4"` / `row="span 2"` to place themselves.
 */
export function BentoTile({
  col = "span 4",
  row = "span 2",
  label,
  title,
  titleSize = 14,
  right,
  variant = "default",
  padding = 18,
  className,
  children,
}) {
  const isAccent = variant === "accent";
  return (
    <div
      className={cn(
        // `min-h-0` is critical when the tile sits in a grid row with
        // `minmax(0, 1fr)`: without it, grid items default to
        // `min-height: auto` and grow to fit their min-content, which
        // overrides the 1fr cap and pushes the section past the viewport.
        "relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-tile)] border",
        isAccent
          ? "border-accent bg-accent text-accent-on"
          : "border-border bg-card text-fg",
        className,
      )}
      style={{ gridColumn: col, gridRow: row, padding }}
    >
      {label || right ? (
        <div className="mb-2 flex items-center justify-between gap-2">
          <MonoLabel className={isAccent ? "text-[rgba(255,255,255,0.75)]" : ""}>
            {label}
          </MonoLabel>
          {right ? <div>{right}</div> : null}
        </div>
      ) : null}
      {title ? (
        <div
          className="mb-1.5 font-semibold leading-tight"
          style={{
            fontSize: titleSize,
            letterSpacing: "-0.1px",
          }}
        >
          {title}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

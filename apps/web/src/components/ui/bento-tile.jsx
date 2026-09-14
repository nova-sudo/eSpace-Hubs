import { cn } from "@/lib/cn";
import { Label } from "./label";
import { Badge } from "./badge";

/**
 * Bento-grid tile — the basic dashboard building block. Renders through the
 * card recipe (no border, xl radius, shadow-card).
 *
 * The dashboard grid is 12-col with a fixed `gridAutoRows` (density-driven).
 * Callers pass `col="span 4"` / `row="span 2"` to place themselves.
 */
export function BentoTile({
  col = "span 4",
  row = "span 2",
  label,
  title,
  titleSize = 15,
  right,
  usedInEvidence = false,
  variant = "default",
  padding = 18,
  className,
  children,
}) {
  const isInk = variant === "accent";

  return (
    <div
      className={cn(
        // `min-h-0` is critical when the tile sits in a grid row with
        // `minmax(0, 1fr)`: without it, grid items default to
        // `min-height: auto` and grow to fit their min-content, which
        // overrides the 1fr cap and pushes the section past the viewport.
        "relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-xl)]",
        isInk ? "bg-ink text-ink-on" : "bg-card text-fg",
        className,
      )}
      style={{
        gridColumn: col,
        gridRow: row,
        padding,
        boxShadow: isInk ? undefined : "var(--shadow-card)",
      }}
    >
      {label || right || usedInEvidence ? (
        <div className="mb-2 flex items-center justify-between gap-2">
          <Label className={isInk ? "text-ink-on/70" : ""}>{label}</Label>
          <div className="flex items-center gap-1.5">
            {usedInEvidence ? <Badge tone={isInk ? "ink" : "neutral"}>Evidence</Badge> : null}
            {right ? <div>{right}</div> : null}
          </div>
        </div>
      ) : null}
      {title ? (
        <div className="mb-1.5 font-bold leading-[1.3]" style={{ fontSize: titleSize }}>
          {title}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

import { cn } from "@/lib/cn";

/**
 * Generic panel. `variant="accent"` = solid accent background used for hero CTAs.
 */
export function Card({ children, variant = "default", className, style }) {
  const isAccent = variant === "accent";
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[var(--radius-tile)] border",
        isAccent
          ? "border-accent bg-accent text-accent-on"
          : "border-border bg-card text-fg",
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}

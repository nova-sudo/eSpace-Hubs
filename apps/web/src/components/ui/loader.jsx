"use client";

/**
 * <Loader /> — the project's single loading glyph: three pulsing dots in
 * currentColor. Sized by token; inherits `currentColor` so it adapts to
 * whatever surface it sits on unless a `color` is passed.
 *
 * `loader` and `speed` are accepted for back-compat (old preset ids from
 * the retired dot-loader library) and ignored — there is one animation now.
 *
 * <Loading /> is the centered fill for a whole page / section / panel
 * (the dot pulse plus an optional caption).
 */

import { cn } from "@/lib/cn";

const SIZES = { xs: 4, sm: 5, md: 6, lg: 8, xl: 10, "2xl": 14 };

export function Loader({
  size = "md",
  color,
  label = "Loading",
  className = "",
  style,
  // Back-compat no-ops:
  loader: _loader,
  speed: _speed,
}) {
  const dot = SIZES[size] || SIZES.md;
  return (
    <span
      role="status"
      aria-label={label}
      className={cn("inline-flex items-center", className)}
      style={{ gap: dot * 0.6, color: color || "currentColor", ...style }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          className="inline-block rounded-full motion-safe:animate-pulse"
          style={{
            width: dot,
            height: dot,
            background: "currentColor",
            animationDelay: `${i * 160}ms`,
          }}
        />
      ))}
    </span>
  );
}

/**
 * Centered loading fill for a whole page / section / panel. Use while a
 * data store is still hydrating so the empty state never flashes first.
 */
export function Loading({ size = "xl", label, color = "var(--muted-fg)", className }) {
  return (
    <div
      className={cn(
        "flex w-full flex-1 flex-col items-center justify-center gap-3 py-10",
        className,
      )}
      role="status"
      aria-live="polite"
      style={{ color }}
    >
      <Loader size={size} label={label || "Loading"} />
      {label ? <span className="text-[13px] text-muted-fg">{label}</span> : null}
    </div>
  );
}

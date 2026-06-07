"use client";

/**
 * <Loader /> — the project's single loading glyph, wrapping @dot-loaders
 * (braille / dot-grid animations). One component, one prop to pick the
 * animation, sized by token. Inherits `currentColor`, so it adapts to
 * whatever surface it sits on (white-on-indigo tiles, dark cards, muted
 * footers) unless you pass `color`.
 *
 *   <Loader loader="dna-helix" size="lg" label="Loading goals" />
 *
 * `loader` is any @dot-loaders preset id:
 *   dna-helix · scan · checkerboard · helix · scanline-grid · spiral ·
 *   pulse · pulse-soft · diagonal-swipe · sand · braille-wave   (+ more)
 *
 * Animation respects prefers-reduced-motion automatically. If the library
 * ever throws (bad id, render fault) it degrades to three pulsing dots —
 * a loader must never crash the surface it sits on.
 *
 * <Loading /> is the centered fill for a whole page / section / panel
 * (big signature loader + optional caption).
 */

import { Component } from "react";
import { Loader as DotLoader } from "@dot-loaders/react";
import { curatedLoaders } from "@dot-loaders/presets";
import { registerLoaders, listRegisteredLoaders } from "@dot-loaders/core";
import { cn } from "@/lib/cn";

// Importing `curatedLoaders` runs the presets module, which registers the
// curated set into @dot-loaders/core's registry (the same instance the
// React component reads). This gated call is belt-and-suspenders in case a
// bundler ever tree-shakes that side effect away.
if (listRegisteredLoaders().length === 0) {
  try {
    registerLoaders(curatedLoaders);
  } catch {
    /* already registered — ignore */
  }
}

// size → svg-grid cell metrics (dot loaders) + font-size (text loaders) +
// fallback dot diameter. Both renderer knobs are set so a preset using
// either renderer is sized correctly; the unused one is ignored.
const SIZES = {
  xs: { fontSize: 12, cellSize: 2, gap: 1, dot: 4 },
  sm: { fontSize: 15, cellSize: 2.5, gap: 1, dot: 5 },
  md: { fontSize: 22, cellSize: 3, gap: 1.5, dot: 6 },
  lg: { fontSize: 32, cellSize: 4, gap: 2, dot: 8 },
  xl: { fontSize: 46, cellSize: 6, gap: 2.5, dot: 10 },
  "2xl": { fontSize: 66, cellSize: 9, gap: 3, dot: 14 },
};

/** Pure-CSS fallback: three pulsing dots in currentColor. */
function DotFallback({ size = "md", label = "Loading", className, style }) {
  const sz = SIZES[size] || SIZES.md;
  return (
    <span
      role="status"
      aria-label={label}
      className={cn("inline-flex items-center", className)}
      style={{ gap: sz.dot * 0.6, color: "currentColor", ...style }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          className="inline-block rounded-full motion-safe:animate-pulse"
          style={{
            width: sz.dot,
            height: sz.dot,
            background: "currentColor",
            animationDelay: `${i * 160}ms`,
          }}
        />
      ))}
    </span>
  );
}

class LoaderBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function Loader({
  loader = "pulse",
  size = "md",
  color,
  label = "Loading",
  speed,
  className = "",
  style,
}) {
  const sz = SIZES[size] || SIZES.md;
  return (
    <LoaderBoundary
      fallback={
        <DotFallback size={size} label={label} className={className} style={{ color, ...style }} />
      }
    >
      <DotLoader
        loader={loader}
        {...(speed != null ? { speed } : {})}
        rendererOptions={{ cellSize: sz.cellSize, gap: sz.gap }}
        fallbackLabel={label}
        aria-label={label}
        className={className}
        style={{
          fontSize: sz.fontSize,
          color: color || "currentColor",
          lineHeight: 1,
          ...style,
        }}
      />
    </LoaderBoundary>
  );
}

/**
 * Centered loading fill for a whole page / section / panel. Use while a
 * data store is still hydrating so the empty state never flashes first.
 *
 *   if (!fetched) return <Loading loader="dna-helix" label="Loading goals…" />;
 */
export function Loading({
  loader = "dna-helix",
  size = "xl",
  label,
  color = "var(--muted-fg)",
  className,
}) {
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
      <Loader loader={loader} size={size} label={label || "Loading"} />
      {label ? (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.3px",
            color: "var(--muted-fg)",
          }}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}

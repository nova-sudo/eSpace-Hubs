/**
 * Shared empty / loading / error state for dashboard tiles.
 *
 * The dashboard had three flavours of placeholder scattered across 11 tiles:
 *   - Single character "…" rendered at the same font-size as the headline
 *     metric (jarring on first paint — it looks like the value IS "…")
 *   - "Loading…" text in muted-fg
 *   - "No X in this period." text
 *
 * Replacing them with a single component buys:
 *   - Visual consistency — same skeleton shape across the grid
 *   - Real loading affordance (animated pulse bars instead of a single char)
 *   - Accessibility — `aria-live="polite"` on transitions, `role="status"`
 *   - One place to evolve the look later (shimmer animation, etc.)
 *
 * Three modes:
 *   loading — pulse bars matching a typical tile silhouette
 *   empty   — icon + label + optional sublabel; no animation
 *   error   — same shape as empty but with the error-tone accent
 *
 * Usage:
 *   if (isLoading) return <TileState kind="loading" />;
 *   if (error)     return <TileState kind="error" message={error.message} />;
 *   if (!data)     return <TileState kind="empty" message="No data yet." sub="Connect GitHub in Settings." />;
 */

import { cn } from "@/lib/cn";
import { Loader } from "./loader";

// Loading glyph per silhouette — a tile's loading affordance matches the
// shape of the content it's standing in for. All are dot-loaders so the
// "data is coming" beat reads consistently across the whole grid.
const LOADING_LOADER = {
  stat: "pulse",
  list: "diagonal-swipe",
  chart: "scanline-grid",
  kanban: "checkerboard",
};

export function TileState({
  kind = "loading",
  message,
  sub,
  // `silhouette` lets a tile match the placeholder to its actual content.
  // Defaults to "stat" — one big number + 1 line of meta, which covers
  // most overview tiles.
  silhouette = "stat",
  // Optional explicit dot-loader id, overriding the silhouette default.
  loader,
  className,
}) {
  if (kind === "loading") {
    return (
      <div
        className={cn(
          "flex h-full min-h-0 w-full flex-1 items-center justify-center text-muted-fg",
          className,
        )}
        role="status"
        aria-live="polite"
        aria-label={message || "Loading"}
      >
        <Loader
          loader={loader || LOADING_LOADER[silhouette] || "pulse-soft"}
          size={silhouette === "chart" || silhouette === "kanban" ? "lg" : "md"}
          label={message || "Loading"}
        />
      </div>
    );
  }

  // empty / error — identical layout, different tone.
  const tone =
    kind === "error" ? "var(--fg)" : "var(--muted-fg)";
  const accent =
    kind === "error" ? "#c0392b" : "var(--muted-fg)";
  return (
    <div
      className={cn("flex h-full min-h-0 w-full flex-1 flex-col justify-center", className)}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-baseline gap-2">
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: accent }}
        />
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: tone,
            letterSpacing: "0.2px",
          }}
        >
          {message || (kind === "error" ? "Couldn't load." : "No data in this window.")}
        </span>
      </div>
      {sub ? (
        <div
          className="mt-1.5 max-w-[28ch]"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--muted-fg)",
            lineHeight: 1.45,
          }}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
}

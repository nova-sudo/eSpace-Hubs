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

export function TileState({
  kind = "loading",
  message,
  sub,
  // `silhouette` lets a tile match the new placeholder shape to its actual
  // content. Defaults to "stat" — one big number + 1 line of meta, which
  // covers most overview tiles.
  silhouette = "stat",
  className,
}) {
  if (kind === "loading") {
    return (
      <div
        className={cn(
          "flex h-full min-h-0 w-full flex-1 flex-col gap-2.5 motion-safe:animate-pulse",
          className,
        )}
        role="status"
        aria-live="polite"
        aria-label={message || "Loading"}
      >
        <Skeleton silhouette={silhouette} />
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

function Skeleton({ silhouette }) {
  // Each silhouette is a small JSX recipe — easy to extend (add "table",
  // "kanban", etc. as they're needed). Heights and gaps mirror the tile
  // chrome's `padding: 18` so the placeholder stays inside the bordered box.
  switch (silhouette) {
    case "list":
      return (
        <>
          <Bar w="55%" h={10} />
          <Bar w="92%" h={8} />
          <Bar w="86%" h={8} />
          <Bar w="72%" h={8} />
          <Bar w="60%" h={8} />
        </>
      );
    case "chart":
      return (
        <>
          <Bar w="40%" h={10} />
          <Bar w="100%" h={56} />
          <Bar w="60%" h={8} />
        </>
      );
    case "kanban":
      return (
        <div className="grid h-full min-h-0 grid-cols-3 gap-2.5">
          <Column />
          <Column />
          <Column />
        </div>
      );
    case "stat":
    default:
      return (
        <>
          <Bar w="40%" h={10} />
          <Bar w="55%" h={28} />
          <Bar w="70%" h={8} />
        </>
      );
  }
}

function Column() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <Bar w="60%" h={9} />
      <Bar w="100%" h={18} />
      <Bar w="100%" h={18} />
      <Bar w="100%" h={18} />
    </div>
  );
}

function Bar({ w, h }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        background: "var(--border)",
        borderRadius: 4,
      }}
    />
  );
}

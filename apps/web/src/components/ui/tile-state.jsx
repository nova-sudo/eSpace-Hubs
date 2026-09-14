/**
 * Shared empty / loading / error state for dashboard tiles.
 *
 * Three modes:
 *   loading — a centered dot pulse
 *   empty   — dot + label + optional sublabel; no animation
 *   error   — same shape as empty but peach (danger) tone
 *
 * Usage:
 *   if (isLoading) return <TileState kind="loading" />;
 *   if (error)     return <TileState kind="error" message={error.message} />;
 *   if (!data)     return <TileState kind="empty" message="No data yet." sub="Connect GitHub in Settings." />;
 */

import { cn } from "@/lib/cn";
import { Loader } from "./loader";

export function TileState({
  kind = "loading",
  message,
  sub,
  // Back-compat no-ops — one loading style now.
  silhouette: _silhouette,
  loader: _loader,
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
        <Loader size="md" label={message || "Loading"} />
      </div>
    );
  }

  // empty / error — identical layout, different tone.
  const isError = kind === "error";
  return (
    <div
      className={cn("flex h-full min-h-0 w-full flex-1 flex-col justify-center", className)}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-baseline gap-2">
        <span
          aria-hidden="true"
          className={cn("inline-block h-1.5 w-1.5 rounded-full", isError ? "bg-peach-ink" : "bg-dim-fg")}
        />
        <span className={cn("text-[13px]", isError ? "text-peach-ink" : "text-muted-fg")}>
          {message || (isError ? "Couldn't load." : "No data in this window.")}
        </span>
      </div>
      {sub ? <div className="mt-1.5 max-w-[28ch] text-[12px] leading-[1.45] text-dim-fg">{sub}</div> : null}
    </div>
  );
}

"use client";

/**
 * Renders in place of a widget when `spec.untrackable` is set.
 *
 * Visual cousin of `<DelegatedCard>` — calm, no-demand tile that shows
 * the user *why* the goal isn't being tracked. The footer "track it"
 * action clears the `untrackable` flag and the spec's underlying widget
 * choice takes over the slot.
 *
 * The reason is treated as user-authored copy (whether the AI emitted
 * it or the user typed it in the Review pane). We italicise it lightly
 * to read as a note rather than a system message.
 */

import { WidgetShell } from "../widget-shell";

export function UntrackableCard({
  spec,
  goal,
  variant = "light",
  className,
  onRetry,
  onClearUntrackable,
}) {
  const reason = spec?.untrackable?.reason;

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label="Untrackable"
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
      footer={
        onClearUntrackable ? (
          <button
            type="button"
            onClick={onClearUntrackable}
            className="uppercase transition-colors hover:opacity-90"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              letterSpacing: "0.5px",
              color:
                variant === "light"
                  ? "rgba(255,255,255,0.68)"
                  : "var(--muted-fg)",
            }}
          >
            track it
          </button>
        ) : null
      }
    >
      <div
        className="flex h-full flex-col justify-between gap-2"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          lineHeight: 1.5,
          color:
            variant === "light"
              ? "rgba(255,255,255,0.82)"
              : "var(--muted-fg)",
        }}
      >
        <div>
          <span
            style={{
              color: variant === "light" ? "#ffffff" : "var(--fg)",
              fontWeight: 600,
            }}
          >
            Not currently tracked
          </span>{" "}
          — see reason below.
        </div>
        {reason ? (
          <div
            className="italic"
            style={{
              color:
                variant === "light"
                  ? "rgba(255,255,255,0.78)"
                  : "var(--muted-fg)",
              fontSize: 10.5,
            }}
          >
            “{reason}”
          </div>
        ) : (
          <div
            className="italic"
            style={{
              color:
                variant === "light"
                  ? "rgba(255,255,255,0.55)"
                  : "var(--muted-fg)",
              fontSize: 10.5,
            }}
          >
            No reason recorded.
          </div>
        )}
      </div>
    </WidgetShell>
  );
}

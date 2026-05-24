"use client";

/**
 * Tiny header indicator showing where /api/v1/* calls are going:
 *
 *   • source === "companion":  green pill "via companion · <host>"
 *   • source === "bundled" with `staleHostname` set:  amber pill
 *     "companion offline" (the user's heartbeat went stale; the
 *     catch-all fell back to the bundled API. Once the user reopens
 *     their companion app the chip flips back to green within a
 *     heartbeat window).
 *   • source === "bundled" with no stale host: render nothing —
 *     espace devs without a companion shouldn't see UI for it.
 *
 * Mounted next to UserChip in the layout header.
 */

import { useApiOrigin } from "./use-api-origin.js";

export function CompanionIndicator() {
  const { source, hostname, staleHostname, lastSeenAt } = useApiOrigin();

  if (source === "companion" && hostname) {
    return (
      <span
        title={
          lastSeenAt
            ? `Companion last seen ${new Date(lastSeenAt).toLocaleTimeString()}.`
            : "Companion connected."
        }
        style={pill("good")}
      >
        <Dot color="var(--good, #2da44e)" />
        via companion · {hostname}
      </span>
    );
  }

  if (source === "bundled" && staleHostname) {
    return (
      <span
        title={
          lastSeenAt
            ? `Last heartbeat ${new Date(lastSeenAt).toLocaleTimeString()}. Open your companion app to resume routing.`
            : "Open your companion app to resume routing."
        }
        style={pill("warn")}
      >
        <Dot color="var(--warn, #bf8700)" />
        companion offline
      </span>
    );
  }

  return null;
}

function Dot({ color }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: color,
      }}
    />
  );
}

function pill(tone) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 8px",
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    letterSpacing: "0.4px",
    textTransform: "uppercase",
    border: "1px solid var(--border-strong)",
    borderRadius: 999,
    color: "var(--fg)",
    background: "var(--card)",
    // Tone hints the dot colour; the pill itself stays neutral so it
    // doesn't compete with the user chip.
    opacity: tone === "warn" ? 0.95 : 1,
  };
}

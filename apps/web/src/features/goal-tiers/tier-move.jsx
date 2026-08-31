"use client";

/**
 * Rung-move celebration surfaces (F9 G0.4 / G2.1 / G2.4 / G2.5 core).
 *
 * `TierDeltaBadge({goalId, variant})` — inline animated `from → to`
 * pill rendered next to GoalTierBadge/GoalTierLadder while a fresh
 * transition exists (~6s display; the store's 60s TTL is the backstop).
 * Up-moves also fire ONE sonner toast (id keyed per goal so the
 * double-mounted hook can't stack duplicates); down-moves stay inline
 * in warn tone with NO toast — honest, never punitive (BR-13: no
 * "lost/dropped/failed" framing). An `aria-live="polite"` region
 * announces the plain-text change regardless of motion preferences;
 * the decorative pulse respects `prefers-reduced-motion` via the app's
 * per-component matchMedia pattern (glyph-agent/reveal precedent).
 *
 * Deliberately presentation-only: consumes an already-recorded
 * transition; never grades, never writes.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { TIER_LABELS } from "./tier-diff";
import { TIER_COLOR, tierBadgeFg } from "./tier-colors";
import {
  clearTierTransition,
  getTierTransitionsServerSnapshot,
  getTierTransitionsSnapshot,
  readTierTransition,
  subscribeTierTransitions,
} from "./tier-transitions-store";

const DISPLAY_MS = 6_000;

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** One toast per recorded transition (keyed on the record's timestamp),
 *  id keyed per goal so re-fires update in place instead of stacking. */
const toastedAt = new Map();
function maybeToast(goalId, t) {
  if (t.direction !== "up") return; // down-moves stay inline (G2.5)
  if (toastedAt.get(goalId) === t.at) return;
  toastedAt.set(goalId, t.at);
  toast.success(t.label, {
    id: `tier-move-${goalId}`,
    description: t.steps > 1 ? `Up ${t.steps} rungs.` : "You moved a rung.",
  });
}

export function TierDeltaBadge({ goalId, variant = "dark" }) {
  useSyncExternalStore(
    subscribeTierTransitions,
    getTierTransitionsSnapshot,
    getTierTransitionsServerSnapshot,
  );
  // Tick every second-ish so the ~6s display window elapses without a
  // store event; cheap because it only runs while a transition exists.
  const [, setPulse] = useState(0);
  const transition = readTierTransition(goalId);
  const fresh = transition && Date.now() - transition.at <= DISPLAY_MS;
  const reduced = prefersReducedMotion();
  const clearTimer = useRef(null);

  useEffect(() => {
    if (!transition) return undefined;
    maybeToast(goalId, transition);
    const remaining = Math.max(0, DISPLAY_MS - (Date.now() - transition.at));
    clearTimer.current = setTimeout(() => {
      clearTierTransition(goalId);
      setPulse((p) => p + 1);
    }, remaining + 50);
    return () => clearTimeout(clearTimer.current);
  }, [goalId, transition]);

  if (!transition || !fresh) return null;

  const up = transition.direction === "up";
  const color = up
    ? TIER_COLOR[transition.to] || "var(--good)"
    : "var(--warn)";
  const fg = up ? tierBadgeFg(transition.to) : "var(--warn)";
  const light = variant === "light";

  return (
    <>
      {/* Plain-text announcement for assistive tech — always rendered,
          independent of motion preference (WCAG 4.1.3). */}
      <span aria-live="polite" className="sr-only">
        {up
          ? `Moved to ${TIER_LABELS[transition.to]}`
          : `Rung moved down — now ${TIER_LABELS[transition.to]}`}
      </span>
      <motion.span
        aria-hidden="true"
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, scale: [0.85, 1.08, 1] }}
        transition={{ duration: reduced ? 0.2 : 0.35 }}
        className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-pill)] px-1.5 py-px font-bold uppercase tracking-[0.3px]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          color: up ? fg : "var(--warn)",
          background: up
            ? color
            : light
              ? "rgba(255,255,255,0.10)"
              : "color-mix(in srgb, var(--warn) 12%, transparent)",
          border: up ? "none" : "1px solid var(--warn)",
        }}
        title={
          up
            ? transition.label
            : `Rung moved down — now ${TIER_LABELS[transition.to]}. Not a scold: check the reasoning on the ladder.`
        }
      >
        {up ? "▲" : "▼"} {TIER_LABELS[transition.from]} → {TIER_LABELS[transition.to]}
      </motion.span>
    </>
  );
}

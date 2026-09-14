"use client";

/**
 * Rung-move celebration surfaces (F9 G0.4 / G2.1 / G2.4 / G2.5 core).
 *
 * `TierDeltaBadge({goalId})` — inline `from -> to` badge pair rendered
 * next to GoalTierBadge/GoalTierLadder while a fresh transition exists
 * (~6s display; the store's 60s TTL is the backstop). Up-moves also fire
 * ONE sonner toast (id keyed per goal so the double-mounted hook can't
 * stack duplicates); down-moves stay inline with NO toast — honest, never
 * punitive (BR-13: no "lost/dropped/failed" framing). An `aria-live="polite"`
 * region announces the plain-text change regardless of motion preferences.
 *
 * Deliberately presentation-only: consumes an already-recorded transition;
 * never grades, never writes.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui";
import { TIER_LABELS } from "./tier-diff";
import { tierTone } from "./tier-colors";
import {
  clearTierTransition,
  getTierTransitionsServerSnapshot,
  getTierTransitionsSnapshot,
  readTierTransition,
  subscribeTierTransitions,
} from "./tier-transitions-store";

const DISPLAY_MS = 6_000;

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

export function TierDeltaBadge({ goalId }) {
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

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      {/* Plain-text announcement for assistive tech — always rendered,
          independent of motion preference (WCAG 4.1.3). */}
      <span aria-live="polite" className="sr-only">
        {up
          ? `Moved to ${TIER_LABELS[transition.to]}`
          : `Rung moved down — now ${TIER_LABELS[transition.to]}`}
      </span>
      <Badge tone={tierTone(transition.from)}>{TIER_LABELS[transition.from]}</Badge>
      <ArrowRight size={14} className="text-muted-fg" aria-hidden="true" />
      <Badge tone={tierTone(transition.to)}>{TIER_LABELS[transition.to]}</Badge>
    </span>
  );
}

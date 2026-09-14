"use client";

/**
 * Focus carousel — pages through the priority-sorted attention queue one goal
 * at a time. `queue` is severity-sorted (queue[0] = most-slipping), so the
 * carousel opens on the top priority and you step DOWN the order. Owns the
 * index state; the hero itself renders the prev/next pager (bottom-right of
 * its action row) via the `pager` prop passed down here.
 *
 * Presentation only — each card is pre-derived by useGoalHealth.
 */

import { useState } from "react";
import { FocusHero } from "./focus-hero";

export function FocusCarousel({ queue }) {
  const [index, setIndex] = useState(0);
  if (!Array.isArray(queue) || queue.length === 0) return null;

  // Clamp: filling/settling the current goal drops it from the queue, which
  // reindexes — keep the pointer in range so the carousel lands on the goal
  // that slid into this slot instead of going blank.
  const safe = Math.min(index, queue.length - 1);
  const card = queue[safe];
  const count = queue.length;
  const go = (next) => setIndex(Math.max(0, Math.min(count - 1, next)));

  return (
    // key by goal id → remount on navigate so the hero's modal/skip state
    // never carries onto the next goal.
    <FocusHero
      key={card.goal.id}
      card={card}
      pager={{
        index: safe,
        count,
        onPrev: () => go(safe - 1),
        onNext: () => go(safe + 1),
      }}
    />
  );
}

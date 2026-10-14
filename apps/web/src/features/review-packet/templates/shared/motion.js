"use client";

import { useReducedMotion } from "framer-motion";

/** Delay (seconds) for the nth item of a staggered group, capped so long lists stay snappy. */
export function stagger(n, step = 0.05, max = 0.6) {
  return Math.min(Math.max(n, 0) * step, max);
}

const STATIC = { hidden: {}, show: {} };

/**
 * Shared variants for every packet template. Consumers spread
 * `initial={reduced ? false : "hidden"} animate="show"` on motion elements.
 * When the visitor prefers reduced motion every variant is inert and
 * `reduced` is true so counters and rings can render their final value.
 */
export function useMotionPresets() {
  const reduced = !!useReducedMotion();
  if (reduced) {
    return { reduced, container: STATIC, item: STATIC, pop: STATIC };
  }
  return {
    reduced,
    container: { hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } } },
    item: {
      hidden: { opacity: 0, y: 12 },
      show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1], delayChildren: 0.15 } },
    },
    pop: {
      hidden: { opacity: 0, scale: 0.85 },
      show: { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 420, damping: 22 } },
    },
  };
}

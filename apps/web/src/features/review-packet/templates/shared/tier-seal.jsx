"use client";

import { motion } from "framer-motion";
import { TIER_LABELS, tierTextColor } from "@/features/goal-tiers";
import { useMotionPresets } from "./motion";

/**
 * A rubber-stamp style tier seal: rotated, 2px solid border in the tier's text
 * colour. Lands with a spring (scale 1.6 to 1). Null tier is a neutral
 * "Not graded". Reduced motion renders it in place with no spring.
 */
export function TierSeal({ tier, manager = false }) {
  const { reduced } = useMotionPresets();
  const graded = !!tier;
  const color = graded ? tierTextColor(tier) : "var(--muted-fg)";
  return (
    <motion.span
      role="img"
      aria-label={graded ? `${TIER_LABELS[tier] ?? tier}${manager ? ", manager verdict" : ""}` : "Not graded"}
      initial={reduced ? false : { scale: 1.6, opacity: 0, rotate: -8 }}
      whileInView={{ scale: 1, opacity: 1, rotate: -8 }}
      viewport={{ once: true }}
      transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 18 }}
      style={{ color, borderColor: color }}
      className="inline-flex shrink-0 flex-col items-center rounded-[var(--radius-md)] border-2 border-solid px-2.5 py-1 text-center leading-tight"
    >
      <span className="text-[11px] font-bold tracking-[0.08em] uppercase">
        {graded ? (TIER_LABELS[tier] ?? tier) : "Not graded"}
      </span>
      {manager && graded ? <span className="text-[11px] font-semibold">Manager</span> : null}
    </motion.span>
  );
}

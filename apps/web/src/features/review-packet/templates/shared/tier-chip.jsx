"use client";

import { motion } from "framer-motion";
import { Badge } from "@/components/ui";
import { TIER_LABELS, tierTone } from "@/features/goal-tiers";
import { useMotionPresets } from "./motion";

/**
 * The tier pill. Pops in (scale 0.85 to 1) inside a staggered parent, or on its
 * own (`standalone`). Nested, it inherits the parent row's variant timing. A null tier is a neutral "Not graded"; `manager` adds a small badge.
 */
export function TierChip({ tier, manager = false, standalone = false }) {
  const { reduced, pop } = useMotionPresets();
  const graded = !!tier;
  return (
    <motion.span
      variants={pop}
      {...(standalone ? { initial: reduced ? false : "hidden", animate: "show" } : {})}
      className="inline-flex shrink-0 items-center gap-1.5"
    >
      <Badge tone={graded ? tierTone(tier) : "neutral"} dot={graded}>
        {graded ? (TIER_LABELS[tier] ?? tier) : "Not graded"}
      </Badge>
      {manager && graded ? <Badge tone="ink">Manager</Badge> : null}
    </motion.span>
  );
}

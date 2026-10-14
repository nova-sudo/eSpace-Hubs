"use client";

import { motion } from "framer-motion";
import { useMotionPresets } from "./motion";

/**
 * Circular weight indicator, 0-100 as a share of the whole. Animates the arc
 * from 0. Weight 0 / missing renders a hollow ring.
 */
export function WeightRing({ weight, size = 56, color = "var(--sky-text)" }) {
  const { reduced } = useMotionPresets();
  const w = Number(weight);
  const has = Number.isFinite(w) && w > 0;
  const frac = has ? Math.min(w, 100) / 100 : 0;
  const stroke = Math.max(4, Math.round(size / 10));
  const r = (size - stroke) / 2;
  const c = size / 2;
  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={has ? `Weight ${w}%` : "No weight"}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        {has ? (
          <motion.circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            transform={`rotate(-90 ${c} ${c})`}
            initial={reduced ? false : { pathLength: 0 }}
            animate={{ pathLength: frac }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          />
        ) : null}
      </svg>
      <span className="absolute text-[12px] font-bold text-fg tabular-nums">{has ? `${w}%` : "-"}</span>
    </div>
  );
}

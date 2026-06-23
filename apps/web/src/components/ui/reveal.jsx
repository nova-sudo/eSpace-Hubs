"use client";

/**
 * Reveal — a tiny GSAP entrance wrapper. Fades + lifts its content (or, with
 * `stagger`, its direct children one-by-one) on mount. Respects
 * prefers-reduced-motion (renders static). Re-runs when `deps` change, so it
 * can re-animate on a view/mode switch.
 *
 * Motivated motion only (see the design-taste skill): use for content entering
 * the viewport on navigation / mode change, not as decoration on every node.
 */

import { useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

export function Reveal({
  children,
  className,
  stagger = false,
  y = 18,
  duration = 0.6,
  delay = 0,
  deps = [],
}) {
  const ref = useRef(null);
  useGSAP(
    () => {
      const reduce =
        typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce || !ref.current) return;
      const targets = stagger
        ? gsap.utils.toArray(ref.current.children)
        : ref.current;
      gsap.from(targets, {
        y,
        opacity: 0,
        duration,
        delay,
        ease: "power3.out",
        stagger: stagger ? 0.08 : 0,
        clearProps: "transform,opacity",
      });
    },
    { scope: ref, dependencies: deps, revertOnUpdate: true },
  );
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

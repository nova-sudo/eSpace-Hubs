"use client";

/**
 * Reveal — a tiny entrance wrapper. Fades + lifts its content (or, with
 * `stagger`, its direct children one-by-one) on mount. Respects
 * prefers-reduced-motion (the CSS animation is disabled). Re-runs when
 * `deps` change (the key remounts the wrapper), so it can re-animate on a
 * view/mode switch.
 *
 * Implemented as a CSS animation (`.ui-reveal` in globals.css) rather than a
 * JS tween: a tween that stalls (throttled tab, interrupted effect) leaves
 * content invisible; a CSS animation always settles at the normal styles.
 *
 * Motivated motion only: use for content entering the viewport on
 * navigation / mode change, not as decoration on every node.
 */

import { Children, cloneElement, isValidElement } from "react";
import { cn } from "@/lib/cn";

export function Reveal({
  children,
  className,
  stagger = false,
  y: _y = 18,
  duration: _duration = 0.6,
  delay = 0,
  deps = [],
}) {
  const key = deps.map((d) => String(d)).join("|");
  const base = Math.round(delay * 1000);
  if (!stagger) {
    return (
      <div
        key={key}
        className={cn("ui-reveal", className)}
        style={{ "--reveal-delay": `${base}ms` }}
      >
        {children}
      </div>
    );
  }
  return (
    <div key={key} className={className}>
      {Children.map(children, (child, i) => {
        if (!isValidElement(child)) return child;
        const style = {
          ...(child.props.style || {}),
          "--reveal-delay": `${base + i * 80}ms`,
        };
        return cloneElement(child, {
          className: cn("ui-reveal", child.props.className),
          style,
        });
      })}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useMotionValue } from "framer-motion";
import { useMotionPresets } from "./motion";

/** A number that ticks up from 0. Static (final value) under reduced motion. */
export function CountUp({ value, duration = 0.9 }) {
  const { reduced } = useMotionPresets();
  const target = Number.isFinite(value) ? value : 0;
  const mv = useMotionValue(reduced ? target : 0);
  const [shown, setShown] = useState(reduced ? target : 0);
  const first = useRef(true);

  useEffect(() => {
    if (reduced) {
      mv.set(target);
      setShown(target);
      return undefined;
    }
    const unsub = mv.on("change", (v) => setShown(Math.round(v)));
    const controls = animate(mv, target, { duration: first.current ? duration : duration / 2, ease: "easeOut" });
    first.current = false;
    return () => {
      unsub();
      controls.stop();
    };
  }, [target, duration, reduced, mv]);

  return <span className="tabular-nums">{shown}</span>;
}

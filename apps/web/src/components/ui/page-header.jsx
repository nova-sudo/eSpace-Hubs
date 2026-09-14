"use client";

import { useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { Label } from "./label";

gsap.registerPlugin(useGSAP);

/**
 * Page header: crumb → Display title → optional subtitle on the left;
 * `right` (actions) bottom-aligned on the right. `italicWord` is accepted
 * for back-compat and ignored — the redesign has no accent-word treatment.
 */
export function PageHeader({ crumb, title, italicWord: _italicWord, subtitle, right }) {
  const ref = useRef(null);
  useGSAP(
    () => {
      const reduce =
        typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce || !ref.current) return;
      gsap.from(gsap.utils.toArray(".ph-reveal", ref.current), {
        y: 20,
        opacity: 0,
        duration: 0.7,
        ease: "power3.out",
        stagger: 0.1,
        clearProps: "transform,opacity",
      });
    },
    { scope: ref },
  );
  return (
    <div
      ref={ref}
      className="mb-7 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-6"
    >
      <div>
        {crumb ? (
          <div className="ph-reveal">
            <Label>{crumb}</Label>
          </div>
        ) : null}
        <h1
          className="ph-reveal mt-3.5 text-[40px] font-extrabold tracking-[-0.03em] leading-[1.05] text-fg"
          style={{ textWrap: "balance" }}
        >
          {title}
        </h1>
        {subtitle ? (
          <p className="ph-reveal mt-3 max-w-[560px] text-[14.5px] leading-[1.55] text-muted-fg">
            {subtitle}
          </p>
        ) : null}
      </div>
      {right ? <div className="ph-reveal self-end">{right}</div> : null}
    </div>
  );
}

"use client";

import { useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { MonoLabel } from "./mono-label";

gsap.registerPlugin(useGSAP);

/** Eyebrow: accent dot + mono crumb — the Nothing UI section marker. */
function Eyebrow({ children }) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: "var(--accent)" }}
      />
      <MonoLabel>{children}</MonoLabel>
    </div>
  );
}

/**
 * Editorial page header used by secondary screens (evidence, snapshots, settings).
 * The title renders in the dot-matrix display face (Doto); `italicWord` becomes
 * the accent dot-word via `em.accent` (Doto + cobalt, see globals.css).
 */
export function PageHeader({ crumb, title, italicWord, subtitle, right }) {
  const parts =
    italicWord && title?.includes(italicWord) ? title.split(italicWord) : null;
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
            <Eyebrow>{crumb}</Eyebrow>
          </div>
        ) : null}
        <h1
          className="ph-reveal mt-3.5"
          style={{
            fontFamily: "var(--font-dot)",
            fontWeight: 900,
            fontSize: "clamp(40px, 5.2vw, 62px)",
            lineHeight: 0.92,
            letterSpacing: "1px",
            textTransform: "uppercase",
            textWrap: "balance",
          }}
        >
          {parts ? (
            <>
              {parts[0]}
              <em className="accent">{italicWord}</em>
              {parts[1]}
            </>
          ) : (
            title
          )}
        </h1>
        {subtitle ? (
          <p className="ph-reveal mt-3 max-w-[640px] text-[14.5px] leading-[1.55] text-muted-fg">
            {subtitle}
          </p>
        ) : null}
      </div>
      {right ? <div className="ph-reveal">{right}</div> : null}
    </div>
  );
}

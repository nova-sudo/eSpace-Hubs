"use client";

import { useEffect, useRef } from "react";
import { useActiveSection } from "./use-active-section";

/**
 * A single scroll-snap section. Renders an optional `.sec-head` (italic-serif
 * accent number + 22px title + mono subtitle) and the children stack below.
 *
 * The section registers itself with the ScrollShell so the rail + counter
 * can find it. Registration is idempotent — strict-mode double-mounting is
 * safe because `register` returns an unregister.
 */
export function Section({
  id,
  number, // "01", "02", … shown in accent italic serif
  title,
  subtitle,
  railLabel, // defaults to title lower-cased one-word-ish; falls back to id
  showHead = true,
  children,
  className = "",
}) {
  const ref = useRef(null);
  const { register } = useActiveSection();

  useEffect(() => {
    if (!ref.current) return;
    const unregister = register({
      id,
      node: ref.current,
      label: railLabel || defaultLabel(title, id),
      number,
    });
    return unregister;
  }, [id, title, number, railLabel, register]);

  return (
    <section
      ref={ref}
      id={id}
      data-section-id={id}
      aria-labelledby={title ? `${id}-title` : undefined}
      className={`relative z-[2] ${className}`}
      style={{
        scrollSnapAlign: "start",
        scrollSnapStop: "always",
        // Strict viewport height so `flex-1` grids inside actually constrain
        // their rows. `min-height` would let the section grow to fit tall
        // tile content, which defeats the 1fr grid rows.
        height: "calc(100vh - var(--header-height))",
        padding: "36px 40px 44px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        overflow: "hidden",
      }}
    >
      {showHead && (title || number) ? (
        <header
          className="flex items-baseline justify-between gap-5 border-b border-border pb-2.5"
        >
          <div className="flex items-baseline gap-3.5">
            {number ? (
              <span
                className="text-accent"
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: 22,
                  fontWeight: 500,
                  lineHeight: 1,
                }}
              >
                {number}
              </span>
            ) : null}
            {title ? (
              <h2
                id={`${id}-title`}
                className="m-0 font-semibold"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 22,
                  letterSpacing: "-0.5px",
                  lineHeight: 1.2,
                }}
              >
                {title}
              </h2>
            ) : null}
          </div>
          {subtitle ? (
            <span
              className="uppercase text-muted-fg"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10.5,
                letterSpacing: "0.6px",
              }}
            >
              {subtitle}
            </span>
          ) : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

function defaultLabel(title, id) {
  if (!title && !id) return "";
  const src = id || title;
  return String(src)
    .replace(/^sec-/, "")
    .toLowerCase()
    .split(/[\s·]+/)[0];
}

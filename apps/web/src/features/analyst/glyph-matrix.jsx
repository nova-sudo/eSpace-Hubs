"use client";

/**
 * GlyphMatrix — the dot-matrix "instrument" at the heart of the GLYPH analyst.
 * An 11×11 grid of dots whose pattern encodes the analyst's state, now driven
 * by GSAP: a staggered entrance morph, a per-state ambient loop, periodic
 * radar-ping bursts, whole-grid breathing, and a scan sweep while thinking.
 *
 *   state="idle"     → concentric ring, slow breathing      (Launch / ready)
 *   state="thinking" → diagonal wave + scan line            (Analysis / running)
 *   state="review"   → lens ring pulsing outward            (Review / awaiting input)
 *   state="live"     → equalizer columns bouncing           (Widgets / tracking)
 *   state="talk"     → centred speech dots pulsing          (Chat / listening)
 *
 * GSAP per gsap-react skill: useGSAP() scoped to the container, automatic
 * cleanup on unmount + on every state change (revertOnUpdate), client-only.
 * prefers-reduced-motion → static colored grid, no loops.
 */

import { useMemo, useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

const N = 11;
// Literal colors (the rail is always dark, so var() resolution isn't needed and
// GSAP can tween between these directly). Mirror analyst.css --glyph-* values.
const ON = "#557CFF";
const MID = "rgba(255,255,255,0.42)";
const OFF = "rgba(255,255,255,0.09)";
const COLOR = [OFF, MID, ON];

const EQ_HEIGHTS = [3, 6, 4, 8, 5, 9, 7, 4, 8, 5, 3];

function intensityAt(state, x, y) {
  const dx = x - 5;
  const dy = y - 5;
  const d = Math.sqrt(dx * dx + dy * dy);
  switch (state) {
    case "thinking": {
      const b = (x + y) % 5;
      return b === 0 ? 2 : b === 1 ? 1 : 0;
    }
    case "live": {
      const h = EQ_HEIGHTS[x];
      const fromBottom = N - 1 - y;
      return fromBottom < h ? (fromBottom >= h - 1 ? 2 : 1) : 0;
    }
    case "review":
      return d >= 3 && d < 4.1 ? 2 : d < 3 ? 1 : 0;
    case "talk":
      if (y === 5 && (x === 3 || x === 5 || x === 7)) return 2;
      return d < 2.2 ? 1 : 0;
    case "idle":
    default:
      if (d < 1) return 2;
      if (d >= 3.1 && d < 4.1) return 2;
      if (d >= 2 && d < 3.1) return 1;
      return 0;
  }
}

export function GlyphMatrix({ state = "idle", dot = 12, gap = 6 }) {
  const scope = useRef(null);
  const cells = useMemo(() => {
    const out = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) out.push({ x, y });
    return out;
  }, []);

  useGSAP(
    () => {
      const dots = gsap.utils.toArray(".glyph-dot", scope.current);
      if (!dots.length) return;
      const grid = scope.current.querySelector(".glyph-grid");
      const ring = scope.current.querySelector(".glyph-ring");

      // Tag each dot with its state intensity so function-based values can read it.
      dots.forEach((d) => {
        d._v = intensityAt(state, Number(d.dataset.x), Number(d.dataset.y));
      });

      const reduce =
        typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (reduce) {
        dots.forEach((d) =>
          gsap.set(d, { backgroundColor: COLOR[d._v], scale: 1, opacity: 1 }),
        );
        if (ring) gsap.set(ring, { opacity: 0 });
        return;
      }

      // 1 ── Transition/entrance: morph each dot to its target colour and pop
      //      in from center. Runs once per state change.
      gsap.to(dots, {
        backgroundColor: (i, t) => COLOR[t._v],
        duration: 0.5,
        ease: "power2.out",
        stagger: { grid: [N, N], from: "center", amount: 0.5 },
      });
      gsap.fromTo(
        dots,
        { scale: 0.25, opacity: 0.2 },
        {
          scale: 1,
          opacity: 1,
          duration: 0.65,
          ease: "back.out(2)",
          stagger: { grid: [N, N], from: "center", amount: 0.55 },
        },
      );

      // 2 ── Ambient loop, flavoured per state.
      if (state === "live") {
        const onDots = dots.filter((d) => d._v > 0);
        gsap.to(onDots, {
          scaleY: 1.7,
          transformOrigin: "50% 100%",
          duration: 0.5,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
          stagger: { grid: [N, N], from: "edges", axis: "x", amount: 0.9 },
        });
      } else if (state === "talk") {
        const center = dots.filter((d) => d._v === 2);
        gsap.to(center, {
          scale: 1.6,
          duration: 0.42,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
          stagger: { each: 0.14, repeat: -1, yoyo: true },
        });
      } else {
        // idle / thinking / review share a center-out shimmer, tuned by speed.
        const dur = state === "thinking" ? 0.9 : state === "review" ? 1.2 : 1.7;
        gsap.to(dots, {
          scale: (i, t) => (t._v === 2 ? 1.3 : t._v === 1 ? 1.12 : 1),
          opacity: (i, t) => (t._v > 0 ? 1 : 0.55),
          duration: dur,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
          stagger: {
            grid: [N, N],
            from: state === "thinking" ? "start" : "center",
            amount: state === "thinking" ? 1.3 : 0.9,
          },
        });
      }

      // 3 ── Whole-grid breathing — the "machine is alive" base layer.
      gsap.to(grid, {
        scale: 1.05,
        duration: 3,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
      });

      // 4 ── Radar-ping burst: an expanding ring fired from center on a loop.
      //      Faster cadence while thinking. Separate overlay element so it never
      //      fights the dots' own scale.
      if (ring) {
        gsap.set(ring, { scale: 0.25, opacity: 0 });
        gsap.to(ring, {
          keyframes: [
            { opacity: 0.55, duration: 0.05 },
            { scale: 1.9, opacity: 0, duration: 1.5, ease: "power2.out" },
          ],
          repeat: -1,
          repeatDelay: state === "thinking" ? 0.9 : 2.4,
        });
      }
    },
    { scope, dependencies: [state], revertOnUpdate: true },
  );

  const grid = (
    <div
      className="glyph-grid"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${N}, ${dot}px)`,
        gridAutoRows: `${dot}px`,
        gap,
        willChange: "transform",
      }}
    >
      {cells.map(({ x, y }, i) => (
        <i
          key={i}
          className="glyph-dot"
          data-x={x}
          data-y={y}
          style={{
            width: dot,
            height: dot,
            borderRadius: "50%",
            background: OFF,
            willChange: "transform, opacity, background-color",
          }}
        />
      ))}
    </div>
  );

  const span = N * dot + (N - 1) * gap;

  return (
    <div ref={scope} style={{ position: "relative", display: "inline-block" }}>
      {/* radar-ping overlay, centered over the grid */}
      <div
        className="glyph-ring"
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: span,
          height: span,
          marginTop: -span / 2,
          marginLeft: -span / 2,
          borderRadius: "50%",
          border: "1px solid rgba(85,124,255,0.6)",
          opacity: 0,
          pointerEvents: "none",
          willChange: "transform, opacity",
        }}
      />
      {grid}
      {state === "thinking" ? (
        <div
          className="glyph-scan"
          aria-hidden="true"
          style={{
            position: "absolute",
            left: -gap,
            right: -gap,
            top: 0,
            height: dot + 8,
            background:
              "linear-gradient(180deg, transparent, rgba(85,124,255,0.35), transparent)",
            animation: "glyphScan 2.4s linear infinite",
            pointerEvents: "none",
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Map the analyst's mode + classify phase to a GlyphMatrix state.
 *   analysis + running → "thinking"; analysis idle → "idle"
 *   review             → "review"
 *   chat               → "talk"
 *   widgets + specs    → "live"; widgets empty → "idle"
 */
export function glyphStateFor({ mode, phase, hasSpecs }) {
  if (mode === "analysis") return phase === "running" ? "thinking" : "idle";
  if (mode === "review") return "review";
  if (mode === "chat") return "talk";
  if (mode === "widgets") return hasSpecs ? "live" : "idle";
  return "idle";
}

export default GlyphMatrix;

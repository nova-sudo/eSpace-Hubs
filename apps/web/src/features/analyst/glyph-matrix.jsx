"use client";

/**
 * GlyphMatrix — the dot-matrix "instrument" at the heart of the GLYPH analyst
 * redesign. An 11×11 grid of dots whose pattern encodes the analyst's current
 * state. Always rendered on the dark instrument rail.
 *
 *   state="idle"     → concentric ring     (Launch / ready)
 *   state="thinking" → diagonal wave + scan(Analysis / running)
 *   state="review"   → lens ring           (Review / awaiting input)
 *   state="live"     → equalizer columns   (Widgets / tracking)
 *   state="talk"     → centred speech dots  (Chat / listening)
 *
 * Pure presentational. Colors + keyframes (glyphBreathe / glyphScan) live in
 * globals.css. Use glyphStateFor({ mode, phase, hasSpecs }) to derive `state`.
 */

import { useMemo } from "react";

const N = 11;
const ON = "var(--glyph-on, #557CFF)";
const MID = "var(--glyph-mid, rgba(255,255,255,0.42))";
const OFF = "var(--glyph-off, rgba(255,255,255,0.09))";
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

export function GlyphMatrix({ state = "idle", dot = 12, gap = 6, scan = true }) {
  const cells = useMemo(() => {
    const out = [];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) out.push(COLOR[intensityAt(state, x, y)]);
    }
    return out;
  }, [state]);

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <div
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: `repeat(${N}, ${dot}px)`,
          gridAutoRows: `${dot}px`,
          gap,
          animation: "glyphBreathe 4s ease-in-out infinite",
        }}
      >
        {cells.map((c, i) => (
          <i key={i} style={{ width: dot, height: dot, borderRadius: "50%", background: c }} />
        ))}
        {scan && state === "thinking" ? (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: -gap,
              right: -gap,
              height: dot + 6,
              background:
                "linear-gradient(180deg, transparent, rgba(85,124,255,0.35), transparent)",
              animation: "glyphScan 2.4s linear infinite",
              pointerEvents: "none",
            }}
          />
        ) : null}
      </div>
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

"use client";

/**
 * GlyphAgent — the emotive dot-matrix instrument for the AI Goal Analyst.
 *
 * A 17×17 LED grid that renders an expressive FACE and reacts to what the
 * analyst is doing: curious while reading, focused while thinking, delighted
 * when a goal is on pace, worried when one is behind, puzzled when data is
 * missing. Dot SIZE tracks brightness, giving an LED-bloom depth.
 *
 * Pure presentational + self-driving (requestAnimationFrame on a <canvas>).
 * No app state, no deps beyond React. Honors prefers-reduced-motion (freezes
 * to a static pose). See glyph-moods.js for glyphMood() — maps analyst
 * mode/phase/goal status to one of the eight emotions.
 *
 *   <GlyphAgent emotion="story" />            // auto job-loop demo
 *   <GlyphAgent emotion={glyphMood(state)} /> // driven by real analyst state
 */

import { useEffect, useRef } from "react";

const N = 17;                 // grid is N×N
const GC = (N - 1) / 2;

/* ---- geometry helpers (operate in normalized [-1,1] coords) ------------- */
const cl = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (x) => 1 - Math.pow(1 - x, 3);
const hash = (k) => { const s = Math.sin(k * 12.9898) * 43758.5453; return s - Math.floor(s); };

function seg(L, ax, ay, bx, by, n, soft, w) {
  for (let i = 0; i < n; i++) { const t = n > 1 ? i / (n - 1) : 0; L.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t, soft, w }); }
}
function arc(L, cx, cy, wid, curve, soft, w) {
  for (let s = -1; s <= 1.001; s += 0.25) L.push({ x: cx + s * wid, y: cy + curve * (1 - s * s), soft, w });
}
function ring(L, cx, cy, r, n, soft, w) {
  for (let i = 0; i < n; i++) { const a = (i / n) * 6.2832; L.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, soft, w }); }
}

/* ---- build a face descriptor for one emotion at time t ------------------ */
function buildFace(name, t, blink) {
  const EX = 0.40, EY = -0.08, RX = 0.165, RY = 0.22;
  const F = { tilt: 0, eyes: [], pts: [] };
  const browL = (ix, iy, ox, oy, w) => seg(F.pts, -EX + ix, iy, -EX - ox, oy, 5, 0.085, w || 0.7);
  const browR = (ix, iy, ox, oy, w) => seg(F.pts, EX - ix, iy, EX + ox, oy, 5, 0.085, w || 0.7);
  const roundEyes = (open, cyoff, gx, rx, ry) => {
    const o = Math.max(0.06, open * blink);
    F.eyes.push({ cx: -EX + (gx || 0), cy: EY + (cyoff || 0), rx: rx || RX, ry: (ry || RY) * o });
    F.eyes.push({ cx: EX + (gx || 0), cy: EY + (cyoff || 0), rx: rx || RX, ry: (ry || RY) * o });
  };
  const happyEyes = (cyoff, bounce) => {
    for (const sgn of [-1, 1]) for (let s = -1; s <= 1.001; s += 0.4)
      F.pts.push({ x: sgn * EX + s * 0.16, y: EY + (cyoff || 0) + (bounce || 0) + 0.12 * (s * s) - 0.03, soft: 0.085, w: 0.97 });
  };

  switch (name) {
    case "scan": { // curious — eyes dart, brows up
      const gx = 0.16 * Math.sign(Math.sin(t * 3.0));
      roundEyes(0.92, 0, gx, RX, RY * 0.92);
      browL(0.12, -0.52, 0.15, -0.50, 0.65); browR(0.12, -0.52, 0.15, -0.50, 0.65);
      arc(F.pts, 0, 0.55, 0.16, 0.05, 0.10, 0.6);
      break;
    }
    case "think": { // focused — eyes narrowed, look up, thinking dots
      const gx = 0.07 * Math.sin(t * 1.4);
      roundEyes(0.5, -0.10, gx, RX, RY);
      browL(0.13, -0.40, 0.15, -0.44, 0.6); browR(0.13, -0.40, 0.15, -0.44, 0.6);
      arc(F.pts, 0.10, 0.54, 0.13, -0.02, 0.10, 0.55);
      for (let i = 0; i < 3; i++) { const w = cl(Math.sin(t * 4.5 - i * 0.95)); F.pts.push({ x: 0.44 + i * 0.16, y: -0.74 - i * 0.06, soft: 0.075, w: 0.3 + 0.7 * w }); }
      break;
    }
    case "aha": { // discovery — eyes wide, brows high, 'o' mouth
      roundEyes(1.35, 0, 0, RX * 1.05, RY * 1.18);
      arc(F.pts, -EX, -0.62, 0.16, -0.06, 0.085, 0.8); arc(F.pts, EX, -0.62, 0.16, -0.06, 0.085, 0.8);
      ring(F.pts, 0, 0.56, 0.12, 8, 0.085, 0.85);
      break;
    }
    case "happy": { // delighted — arc eyes, big smile, bounce
      const b = 0.045 * Math.sin(t * 7);
      happyEyes(0.02, b);
      arc(F.pts, 0, 0.50 + b, 0.40, 0.34, 0.10, 0.97);
      browL(0.12, -0.50 + b, 0.15, -0.52 + b, 0.45); browR(0.12, -0.50 + b, 0.15, -0.52 + b, 0.45);
      break;
    }
    case "working": { // determined — narrowed forward, lowered brows, progress bar
      roundEyes(0.72, 0, 0, RX, RY);
      browL(0.12, -0.34, 0.15, -0.42, 0.7); browR(0.12, -0.34, 0.15, -0.42, 0.7);
      arc(F.pts, 0, 0.55, 0.22, 0.02, 0.10, 0.6);
      for (let i = 0; i < 7; i++) { const x = -0.66 + i * 0.22; const w = cl(Math.sin(t * 4 - i * 0.7)); F.pts.push({ x, y: 0.92, soft: 0.075, w: 0.25 + 0.75 * w }); }
      break;
    }
    case "concern": { // worried — inner brows up, look down, frown
      roundEyes(0.9, 0.06, 0, RX, RY);
      browL(0.12, -0.52, 0.15, -0.40, 0.7); browR(0.12, -0.52, 0.15, -0.40, 0.7);
      arc(F.pts, 0, 0.62, 0.34, -0.30, 0.10, 0.9);
      break;
    }
    case "confused": { // puzzled — head tilt, asym eyes, wavy mouth, '?'
      F.tilt = 0.16 * Math.sin(t * 1.7);
      const oL = 1.0 * blink, oR = 0.45 * blink;
      F.eyes.push({ cx: -EX, cy: EY, rx: RX, ry: RY * Math.max(0.06, oL) });
      F.eyes.push({ cx: EX, cy: EY, rx: RX, ry: RY * Math.max(0.06, oR) });
      browL(0.12, -0.56, 0.15, -0.52, 0.65); browR(0.12, -0.40, 0.15, -0.46, 0.65);
      for (let s = -1; s <= 1.001; s += 0.25) F.pts.push({ x: s * 0.30, y: 0.56 + 0.12 * Math.sin(s * 3.1 + t * 3), soft: 0.10, w: 0.85 });
      { const qw = 0.5 + 0.5 * Math.sin(t * 5); arc(F.pts, 0.60, -0.66, 0.10, -0.10, 0.075, 0.5 + 0.5 * qw); F.pts.push({ x: 0.60, y: -0.50, soft: 0.07, w: 0.4 + 0.6 * qw }); F.pts.push({ x: 0.60, y: -0.36, soft: 0.07, w: 0.4 + 0.6 * qw }); }
      break;
    }
    default: { // idle — calm gaze drift, tiny smile
      const gx = 0.05 * Math.sin(t * 0.8);
      roundEyes(1, 0, gx, RX, RY);
      browL(0.12, -0.46, 0.15, -0.46, 0.5); browR(0.12, -0.46, 0.15, -0.46, 0.5);
      arc(F.pts, 0, 0.52, 0.26, 0.12, 0.10, 0.7);
    }
  }
  return F;
}

function faceAt(nx, ny, F) {
  let X = nx, Y = ny;
  if (F.tilt) { const c = Math.cos(F.tilt), s = Math.sin(F.tilt); X = nx * c - ny * s; Y = nx * s + ny * c; }
  let v = 0;
  for (const e of F.eyes) { const dx = (X - e.cx) / e.rx, dy = (Y - e.cy) / e.ry; const d = Math.sqrt(dx * dx + dy * dy); const c = 1.32 - d; if (c > v) v = c; }
  for (const p of F.pts) { const d = Math.hypot(X - p.x, Y - p.y); const c = p.w * (1 - d / p.soft); if (c > v) v = c; }
  return cl(v);
}

/* The demo job-loop. Each row: [emotion, seconds, caption, sub]. */
const STORY = [
  ["idle", 1.4, "READY", "awaiting goals"],
  ["scan", 2.0, "READING", "scanning 13 goals"],
  ["think", 1.6, "THINKING", "matching signals"],
  ["aha", 0.8, "FOUND", "review turnaround"],
  ["happy", 1.1, "ON PACE", "widget built"],
  ["scan", 1.1, "READING", "next goal"],
  ["working", 1.5, "BUILDING", "classifying defects"],
  ["concern", 1.6, "FLAGGED", "behind target"],
  ["scan", 1.0, "READING", "next goal"],
  ["confused", 1.7, "NO DATA", "mentoring quiet"],
  ["think", 1.2, "THINKING", "finalizing"],
  ["happy", 2.0, "DONE", "6 widgets live"],
];

const HOLD_LABELS = {
  idle: ["READY", "idle"], scan: ["READING", "curious"], think: ["THINKING", "focused"],
  aha: ["FOUND", "discovery"], happy: ["ON PACE", "delighted"], working: ["BUILDING", "determined"],
  concern: ["FLAGGED", "worried"], confused: ["NO DATA", "puzzled"],
};

function parseColor(c) {
  // returns [r,g,b]; accepts #rrggbb or rgb()
  if (c[0] === "#") return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const m = c.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/); return m ? [+m[1], +m[2], +m[3]] : [85, 124, 255];
}

export function GlyphAgent({
  emotion = "story", caption, sub, size = 180, accent = "#557CFF", showCaption = true,
}) {
  const canvasRef = useRef(null);
  const capRef = useRef(null);
  const subRef = useRef(null);
  const stateRef = useRef({ emotion, caption, sub });
  stateRef.current = { emotion, caption, sub };
  // Cross-fade bookkeeping so a prop-driven emotion change morphs (not snaps).
  const shownRef = useRef(null);
  const transRef = useRef({ prev: null, at: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const [ar, ag, ab] = parseColor(accent);
    const dotVar = []; for (let k = 0; k < N * N; k++) dotVar.push(0.84 + 0.40 * hash(k * 7.3));
    let start = 0, raf;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = (now) => {
      raf = requestAnimationFrame(draw);
      if (!start) start = now;
      const t = reduce ? 0.0001 : (now - start) / 1000;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const px = size * dpr;
      if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      const bt = t % 3.1;
      const blink = bt < 0.14 ? cl(Math.abs(bt - 0.07) / 0.07) : 1;

      const { emotion: em } = stateRef.current;
      let curName, prev = null, bf = 1, cap, sb;
      if (em && em !== "story") {
        curName = em; const L = HOLD_LABELS[em] || ["", ""]; cap = L[0]; sb = L[1];
        // Detect a prop-driven change and cross-fade from the prior face.
        if (em !== shownRef.current) {
          transRef.current = { prev: shownRef.current, at: t };
          shownRef.current = em;
        }
        const tr = transRef.current;
        if (tr.prev && tr.prev !== em && !reduce) {
          const local = t - tr.at, BL = 0.45;
          if (local < BL) { bf = ease(local / BL); prev = tr.prev; }
          else tr.prev = null;
        }
      } else {
        const total = STORY.reduce((a, s) => a + s[1], 0); const tt = t % total;
        let acc = 0, idx = 0; for (let i = 0; i < STORY.length; i++) { if (tt < acc + STORY[i][1]) { idx = i; break; } acc += STORY[i][1]; }
        const local = tt - acc, BL = 0.45;
        curName = STORY[idx][0]; cap = STORY[idx][2]; sb = STORY[idx][3];
        if (local < BL) { bf = ease(local / BL); prev = STORY[(idx - 1 + STORY.length) % STORY.length][0]; }
      }

      const Fc = buildFace(curName, t, curName === "happy" ? 1 : blink);
      const Fp = prev ? buildFace(prev, t, prev === "happy" ? 1 : blink) : null;

      const cell = size / N, dotMax = cell * 0.46;
      for (let k = 0; k < N * N; k++) {
        const gx = k % N, gy = (k / N) | 0;
        const nx = (gx - GC) / GC, ny = (gy - GC) / GC;
        let v = faceAt(nx, ny, Fc);
        if (Fp) v = v * bf + faceAt(nx, ny, Fp) * (1 - bf);
        const shimmer = 0.04 + 0.03 * Math.max(0, Math.sin(t * 2 + (gx + gy) * 0.4));
        if (shimmer * 0.6 > v) v = shimmer * 0.6;

        const cx = gx * cell + cell / 2, cy = gy * cell + cell / 2;
        const r = Math.max(cell * 0.07, dotVar[k] * dotMax * (0.26 + 1.0 * v));
        let fill;
        if (v <= 0.06) fill = "rgba(255,255,255,0.05)";
        else { const a = Math.min(1, 0.2 + 0.85 * v); fill = v > 0.85 ? `rgba(216,228,255,${a})` : `rgba(${ar},${ag},${ab},${a})`; }
        ctx.beginPath(); ctx.fillStyle = fill; ctx.arc(cx, cy, r, 0, 6.2832); ctx.fill();
      }

      const ov = stateRef.current;
      if (capRef.current) capRef.current.textContent = ov.caption ?? cap;
      if (subRef.current) subRef.current.textContent = ov.sub ?? sb;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, accent]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <canvas ref={canvasRef} style={{ width: size, height: size, display: "block" }} aria-hidden="true" />
      {showCaption ? (
        <div style={{ textAlign: "center" }}>
          <div ref={capRef} style={{ fontFamily: "var(--font-dot), 'Doto', monospace", fontWeight: 900, fontSize: 20, letterSpacing: 3, textTransform: "uppercase", color: "#fff" }}>READY</div>
          <div ref={subRef} style={{ fontFamily: "var(--font-mono), 'Space Mono', monospace", fontSize: 9, letterSpacing: 0.5, color: "rgba(255,255,255,0.55)", marginTop: 5 }}>&nbsp;</div>
        </div>
      ) : null}
    </div>
  );
}

export default GlyphAgent;

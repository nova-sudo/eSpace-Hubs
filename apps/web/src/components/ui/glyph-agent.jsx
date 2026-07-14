"use client";

/**
 * GlyphAgent — the emotive dot-matrix KAWAII face for the AI Goal Analyst.
 *
 * An N×N square-pixel LED grid that renders an expressive face and reacts to
 * what the analyst is doing: curious while reading, focused while thinking,
 * delighted when a goal is on pace, worried when one is behind, puzzled when
 * data is missing. Big glossy eyes, blush cheeks, brows and expressive mouths.
 * Dot SIZE tracks brightness for LED-bloom depth.
 *
 * Pure presentational + self-driving (requestAnimationFrame on a <canvas>).
 * No app state, no deps beyond React.
 *
 *   <GlyphAgent emotion="story" />            // auto job-loop demo
 *   <GlyphAgent emotion={glyphMood(state)} /> // driven by real analyst state
 *
 * Props:
 *   emotion : "story" | "idle" | "happy" | "proud" | "aha" | "scan" | "think"
 *             | "working" | "concern" | "confused" | "sad" | "cry" | "dizzy"
 *   caption : override the big caption text (else derived from emotion/story)
 *   sub     : override the small sub-caption
 *   size    : px size of the square matrix canvas (default 180)
 *   res     : grid density N (11–96, default 24; larger = finer face)
 *   accent  : structural dot color (default "#557CFF")
 *   comet / cometAngle : optional motion smear (0–1.4 / radians)
 *   showCaption : render the caption block (default true)
 *
 * See glyph-moods.js for glyphMood(). Semantic colors are fixed
 * (pink blush, blue tears, red hearts); everything structural uses `accent`.
 */

import { useEffect, useRef } from "react";

const cl = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (x) => 1 - Math.pow(1 - x, 3);
const hash = (k) => { const s = Math.sin(k * 12.9898) * 43758.5453; return s - Math.floor(s); };

function buildFace(name, t, blink) {
  const EX = 0.46, EY = -0.13, RX = 0.27, RY = 0.35;
  const F = { tilt: 0, eyes: [], pts: [], segs: [], rects: [], hearts: [] };
  const eye = (cx, cy, sq, rx, ry) => F.eyes.push({ cx, cy, rx: rx || RX, ry: (ry || RY) * Math.max(0.08, sq == null ? blink : sq), c: "eye" });
  const hi = (cx, cy) => { if (blink > 0.6) F.eyes.push({ cx: cx - 0.055, cy: cy - 0.085, rx: 0.052, ry: 0.06, c: "hi" }); };
  const discEyes = (gx, gy, sq) => { gx = gx || 0; gy = gy || 0; eye(-EX + gx, EY + gy, sq); eye(EX + gx, EY + gy, sq); hi(-EX + gx, EY + gy); hi(EX + gx, EY + gy); };
  const seg = (ax, ay, bx, by, hw, c) => F.segs.push({ ax, ay, bx, by, hw: hw || 0.02, soft: 0.045, c: c || "eye" });
  const browL = (dip) => seg(-EX - 0.15, EY - 0.34 + (dip || 0), -EX + 0.13, EY - 0.40 - (dip || 0) * 0.6, 0.021);
  const browR = (dip) => seg(EX - 0.13, EY - 0.40 - (dip || 0) * 0.6, EX + 0.15, EY - 0.34 + (dip || 0), 0.021);
  const cheeks = (y) => { for (const s of [-1, 1]) F.eyes.push({ cx: s * 0.66, cy: (y == null ? 0.20 : y), rx: 0.155, ry: 0.115, c: "pink" }); };
  const dot = (x, y, w, c) => F.pts.push({ x, y, soft: 0.1, w: w == null ? 0.92 : w, c: c || "mouth" });
  const arc = (cx, cy, wid, cv, c, n) => { const M = n || 9; for (let i = 0; i < M; i++) { const s = -1 + 2 * i / (M - 1); F.pts.push({ x: cx + s * wid, y: cy + cv * (1 - s * s), soft: 0.095, w: 0.94, c: c || "mouth" }); } };
  const open = (cx, cy, w, h) => { F.rects.push({ x0: cx - w, y0: cy - h, x1: cx + w, y1: cy + h, soft: 0.1, c: "open" }); F.eyes.push({ cx, cy: cy + h * 0.55, rx: w * 0.7, ry: h * 0.5, c: "tongue" }); };
  const xeye = (cx, cy) => { seg(cx - 0.15, cy - 0.16, cx + 0.15, cy + 0.16, 0.023); seg(cx - 0.15, cy + 0.16, cx + 0.15, cy - 0.16, 0.023); };
  const flat = (cx, cy) => seg(cx - 0.16, cy, cx + 0.16, cy, 0.026);
  const arcEye = (cx, cy) => { for (let s = -1; s <= 1.001; s += 0.28) F.pts.push({ x: cx + s * 0.19, y: cy - 0.13 * (1 - s * s), soft: 0.1, w: 0.95, c: "eye" }); };
  const tear = (cx, y0, y1) => F.rects.push({ x0: cx - 0.055, y0, x1: cx + 0.055, y1, soft: 0.06, c: "tear" });
  const wob = (a, f) => a * Math.sin(t * f);

  switch (name) {
    case "happy": { discEyes(0, wob(0.012, 6)); browL(); browR(); arc(0, 0.32, 0.22, 0.14, "mouth", 11); cheeks(); break; }
    case "proud": { const g = wob(0.03, 0.7); arcEye(-EX + g, EY + 0.05); arcEye(EX + g, EY + 0.05); browL(); browR(); arc(0, 0.30, 0.19, 0.13, "mouth", 11); cheeks(0.16); break; }
    case "aha": { discEyes(0, -0.02, Math.max(1.05, blink)); browL(-0.09); browR(-0.09); open(0, 0.36, 0.2, 0.15); cheeks(0.3); break; }
    case "scan": { const g = 0.17 * Math.sin(t * 1.8); discEyes(g, 0, blink); seg(-EX - 0.15, EY - 0.44, -EX + 0.13, EY - 0.33, 0.021); browR(-0.05); open(0.02 + g * 0.5, 0.34, 0.055, 0.05); break; }
    case "think": { const g = -0.14 + wob(0.04, 1.1); discEyes(g, -0.03, blink); browL(0.03); browR(-0.02); arc(0.06, 0.33, 0.11, 0.07); for (let i = 0; i < 3; i++) { const w = cl(Math.sin(t * 3.2 - i * 1.0)); F.pts.push({ x: 0.5 + i * 0.17, y: -0.5 - i * 0.12, soft: 0.08, w: 0.2 + 0.8 * w, c: "eye" }); } break; }
    case "working": { discEyes(0, 0.08, 0.7); browL(); browR(); arc(0, 0.33, 0.1, 0.06, "mouth", 7); for (let i = 0; i < 7; i++) { const x = -0.54 + i * 0.18, w = cl(Math.sin(t * 4 - i * 0.7)); F.pts.push({ x, y: 0.92, soft: 0.07, w: 0.16 + 0.62 * w, c: "eye" }); } break; }
    case "concern": { discEyes(0, 0.03, blink); seg(-EX - 0.15, EY - 0.30, -EX + 0.13, EY - 0.42, 0.03); seg(EX - 0.13, EY - 0.42, EX + 0.15, EY - 0.30, 0.03); arc(0, 0.44, 0.28, -0.22); break; }
    case "confused": { F.tilt = wob(0.16, 1.5); eye(-EX, EY, blink); eye(EX, EY, 0.45 * blink); hi(-EX, EY); browL(-0.06); browR(0.05); for (let s = -1; s <= 1.001; s += 0.25) dot(s * 0.28, 0.36 + 0.11 * Math.sin(s * 3 + t * 3), 0.85, "mouth"); break; }
    case "sad": { discEyes(0, 0.08, blink); seg(-EX - 0.15, EY - 0.28, -EX + 0.13, EY - 0.40, 0.03); seg(EX - 0.13, EY - 0.40, EX + 0.15, EY - 0.28, 0.03); arc(0, 0.46, 0.26, -0.2); break; }
    case "cry": { arc(-EX, EY - 0.02, 0.17, -0.13, "eye"); arc(EX, EY - 0.02, 0.17, -0.13, "eye"); tear(-EX, EY + 0.12, EY + 0.62 + wob(0.05, 5)); tear(EX, EY + 0.12, EY + 0.58 + wob(0.05, 5.5)); arc(0, 0.46, 0.24, -0.18); break; }
    case "dizzy": { xeye(-EX, EY); xeye(EX, EY); open(0, 0.36, 0.18, 0.12); cheeks(0.24); break; }
    default: { discEyes(wob(0.03, 0.8), wob(0.01, 0.6)); arc(0, 0.32, 0.18, 0.12, "mouth", 9); cheeks(); }
  }
  return F;
}

function segCov(X, Y, s) {
  const vx = s.bx - s.ax, vy = s.by - s.ay, L2 = vx * vx + vy * vy || 1e-6;
  let u = ((X - s.ax) * vx + (Y - s.ay) * vy) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u;
  const d = Math.hypot(X - (s.ax + vx * u), Y - (s.ay + vy * u));
  return cl((s.hw - d) / (s.soft || 0.05) + 0.5);
}
function heartCov(X, Y, h) {
  const px = (X - h.cx) / h.s, py = (h.cy - Y) / h.s + 0.25;
  const a = px * px + py * py - 1, f = a * a * a - px * px * py * py * py;
  return f <= 0 ? 1 : cl(1 - f * 2.5);
}
function faceAt(nx, ny, F) {
  let X = nx, Y = ny;
  if (F.tilt) { const c = Math.cos(F.tilt), s = Math.sin(F.tilt); X = nx * c - ny * s; Y = nx * s + ny * c; }
  let v = 0, col = "eye";
  for (const e of F.eyes) { const dx = (X - e.cx) / e.rx, dy = (Y - e.cy) / e.ry; const cov = cl(1.2 - Math.sqrt(dx * dx + dy * dy)); if (cov > v) { v = cov; col = e.c; } }
  for (const p of F.pts) { const cov = p.w * (1 - Math.hypot(X - p.x, Y - p.y) / p.soft); if (cov > v) { v = cov; col = p.c; } }
  for (const s of F.segs) { const cov = segCov(X, Y, s); if (cov > v) { v = cov; col = s.c; } }
  for (const r of F.rects) { const cov = cl(Math.min(Math.min(X - r.x0, r.x1 - X), Math.min(Y - r.y0, r.y1 - Y)) / (r.soft || 0.06) + 0.5); if (cov > v) { v = cov; col = r.c; } }
  for (const h of F.hearts) { const cov = heartCov(X, Y, h); if (cov > v) { v = cov; col = h.c; } }
  return { v: cl(v), c: col };
}

/* The demo job-loop. Each row: [emotion, seconds, caption, sub]. */
const STORY = [
  ["idle", 1.6, "READY", "awaiting goals"],
  ["scan", 1.9, "READING", "scanning 13 goals"],
  ["think", 1.7, "THINKING", "matching signals"],
  ["aha", 0.9, "FOUND", "review turnaround"],
  ["happy", 1.2, "ON PACE", "widget built"],
  ["scan", 1.1, "READING", "next goal"],
  ["working", 1.6, "BUILDING", "classifying defects"],
  ["concern", 1.6, "FLAGGED", "behind target"],
  ["proud", 1.2, "SOLID", "streak holding"],
  ["confused", 1.5, "NO DATA", "mentoring quiet"],
  ["think", 1.2, "THINKING", "finalizing"],
  ["happy", 1.9, "DONE", "6 widgets live"],
];

const HOLD_LABELS = {
  idle: ["READY", "idle"], happy: ["ON PACE", "delighted"], proud: ["SOLID", "pleased"],
  aha: ["FOUND", "discovery"], scan: ["READING", "curious"], think: ["THINKING", "focused"],
  working: ["BUILDING", "determined"], concern: ["FLAGGED", "worried"], confused: ["NO DATA", "puzzled"],
  sad: ["MISSED", "down"], cry: ["OFF TRACK", "upset"], dizzy: ["ERROR", "no signal"],
};

function parseColor(c) {
  if (c[0] === "#") return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const m = c.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/); return m ? [+m[1], +m[2], +m[3]] : [85, 124, 255];
}
function col(c, v, ar, ag, ab) {
  if (c === "hi") return [236, 241, 255, cl(0.55 + 0.5 * v)];
  if (c === "tongue") return [255, 150, 172, cl(0.4 + 0.6 * v)];
  if (c === "pink") return [255, 148, 176, 0.62 * cl(v)];
  if (c === "tear") return [138, 202, 255, cl(0.35 + 0.7 * v)];
  if (c === "open") return [255, 116, 148, cl(0.42 + 0.7 * v)];
  if (c === "heart") return [255, 92, 116, cl(0.35 + 0.85 * v)];
  if (v > 0.88) { const m = (v - 0.88) / 0.12; return [ar + (255 - ar) * 0.55 * m, ag + (255 - ag) * 0.55 * m, ab + (255 - ab) * 0.55 * m, cl(0.3 + 0.85 * v)]; }
  return [ar, ag, ab, cl(0.22 + 0.9 * v)];
}

export function GlyphAgent({
  emotion = "story", caption, sub, size = 180, res = 24, accent = "#557CFF",
  comet = 0, cometAngle = 0, showCaption = true,
}) {
  const canvasRef = useRef(null);
  const capRef = useRef(null);
  const subRef = useRef(null);
  const stateRef = useRef({ emotion, caption, sub, comet, cometAngle });
  stateRef.current = { emotion, caption, sub, comet, cometAngle };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const [ar, ag, ab] = parseColor(accent);
    const N = Math.max(11, Math.min(96, res | 0)), GC = (N - 1) / 2;
    const dotVar = []; for (let k = 0; k < N * N; k++) dotVar.push(0.82 + 0.42 * hash(k * 7.3));
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

      const bt = t % 3.4, blink = bt < 0.15 ? cl(Math.abs(bt - 0.075) / 0.075) : 1;
      const { emotion: em } = stateRef.current;
      let curName, prev = null, bf = 1, cap, sb;
      if (em && em !== "story") { curName = em; const L = HOLD_LABELS[em] || ["", ""]; cap = L[0]; sb = L[1]; }
      else {
        const total = STORY.reduce((a, s) => a + s[1], 0), tt = t % total;
        let acc = 0, idx = 0; for (let i = 0; i < STORY.length; i++) { if (tt < acc + STORY[i][1]) { idx = i; break; } acc += STORY[i][1]; }
        const local = tt - acc, BL = 0.42; curName = STORY[idx][0]; cap = STORY[idx][2]; sb = STORY[idx][3];
        if (local < BL) { bf = ease(local / BL); prev = STORY[(idx - 1 + STORY.length) % STORY.length][0]; }
      }
      const noBlink = curName === "cry" || curName === "dizzy" || curName === "working" || curName === "proud";
      const Fc = buildFace(curName, t, noBlink ? 1 : blink);
      const Fp = prev ? buildFace(prev, t, 1) : null;

      const cell = size / N, dotMax = cell * 0.62, SPREAD = 1.3;
      const cm = Math.max(0, Math.min(1.4, stateRef.current.comet || 0));
      const cang = stateRef.current.cometAngle || 0;
      const dirx = Math.cos(cang), diry = Math.sin(cang);
      const smear = cm * cell * 3.4, trails = cm > 0.02 ? Math.min(9, 2 + Math.round(cm * 7)) : 0;
      for (let k = 0; k < N * N; k++) {
        const gx = k % N, gy = (k / N) | 0, nx = (gx - GC) / GC * SPREAD, ny = (gy - GC) / GC * SPREAD;
        let s = faceAt(nx, ny, Fc), v = s.v, c = s.c;
        if (Fp) { const sp = faceAt(nx, ny, Fp); v = v * bf + sp.v * (1 - bf); if (bf < 0.5) c = sp.c; }
        const lag = cm * cell * (0.5 + 1.5 * dotVar[k]), scat = cm * cell * 1.2 * (dotVar[k] - 0.82);
        const bx = gx * cell + cell / 2 - dirx * lag - diry * scat;
        const by = gy * cell + cell / 2 - diry * lag + dirx * scat;
        const r = Math.max(cell * 0.07, dotVar[k] * dotMax * (0.24 + v));
        if (v <= 0.05 && cm < 0.05) { ctx.fillStyle = "rgba(255,255,255,0.045)"; ctx.fillRect(bx - r, by - r, r * 2, r * 2); continue; }
        const [cr, cg, cb, caA] = col(c, v, ar, ag, ab);
        for (let sIdx = trails; sIdx >= 1; sIdx--) {
          const f = sIdx / trails, tx = bx - dirx * smear * f, ty = by - diry * smear * f, ta = caA * (1 - f) * 0.5;
          if (ta < 0.02) continue; const tr = r * (1 - 0.5 * f);
          ctx.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${ta})`; ctx.fillRect(tx - tr, ty - tr, tr * 2, tr * 2);
        }
        ctx.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${caA})`;
        if (cm > 0.12) { ctx.save(); ctx.translate(bx, by); ctx.rotate(cang); const hw = r * (1 + cm * 2.2), hh = r * Math.max(0.4, 1 - cm * 0.5); ctx.fillRect(-hw, -hh, hw * 2, hh * 2); ctx.restore(); }
        else ctx.fillRect(bx - r, by - r, r * 2, r * 2);
      }
      const ov = stateRef.current;
      if (capRef.current) capRef.current.textContent = ov.caption ?? cap;
      if (subRef.current) subRef.current.textContent = ov.sub ?? sb;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, accent, res]);

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

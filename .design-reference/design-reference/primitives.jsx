// Shared visual primitives for the eSpace Dev Hub redesign.
// - Halftone / dither SVG components (HexaCore-style)
// - Grain/noise overlay
// - Mono label, pills, inline chart components
// All presentation-only, no data dependencies.

const { useMemo, useRef, useEffect, useState } = React;

// ─────────────────────────────────────────────────────────────
// Dither / halftone fields.
// Deterministic pseudo-random dot grid; radius varies with a seeded noise
// function so the texture feels organic, not a perfect grid. Dot color is
// controlled by the caller so we can recolor per theme.
// ─────────────────────────────────────────────────────────────
function dhash(x, y, seed = 1) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + seed * 43.7) * 43758.5453;
  return s - Math.floor(s);
}

// A rectangular dither field — dots get smaller/bigger following a gradient
// direction + noise. `falloff` is a fn (u,v) -> 0..1 density.
function DitherField({
  width = 240,
  height = 140,
  cell = 8,
  color = "currentColor",
  bg = "transparent",
  falloff = (u /* 0..1 */) => 1 - u,          // default: fade left→right
  jitter = 0.35,
  seed = 7,
  className = "",
  style = {},
}) {
  const cols = Math.floor(width / cell);
  const rows = Math.floor(height / cell);
  const dots = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const u = i / (cols - 1);
      const v = j / (rows - 1);
      const d = Math.max(0, Math.min(1, falloff(u, v) + (dhash(i, j, seed) - 0.5) * jitter));
      if (d < 0.05) continue;
      const r = (cell / 2) * 0.95 * d;
      dots.push(
        <circle key={`${i}-${j}`} cx={i * cell + cell / 2} cy={j * cell + cell / 2} r={r} fill={color} />
      );
    }
  }
  return (
    <svg viewBox={`0 0 ${cols * cell} ${rows * cell}`} preserveAspectRatio="none" width="100%" height="100%" className={className} style={style}>
      {bg !== "transparent" && <rect width="100%" height="100%" fill={bg} />}
      {dots}
    </svg>
  );
}

// Circular dither — fills a disc. Used for globe / portrait vibes.
function DitherDisc({ size = 220, cell = 6, color = "currentColor", density = 0.85, seed = 3, className, style = {} }) {
  const n = Math.floor(size / cell);
  const dots = [];
  const cx = (n * cell) / 2, cy = (n * cell) / 2;
  const R = (n * cell) / 2;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = i * cell + cell / 2;
      const y = j * cell + cell / 2;
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) / R;
      if (dist > 1) continue;
      const rn = dhash(i, j, seed);
      // edge feathering + interior micro-noise
      const edge = Math.max(0, 1 - Math.pow(dist, 3));
      const d = edge * (density * (0.55 + rn * 0.5));
      if (d < 0.2) continue;
      dots.push(<circle key={`${i}-${j}`} cx={x} cy={y} r={(cell / 2) * 0.92 * d} fill={color} />);
    }
  }
  return (
    <svg viewBox={`0 0 ${n * cell} ${n * cell}`} width={size} height={size} className={className} style={style}>
      {dots}
    </svg>
  );
}

// Barchart of dots — used to render spark-bars with a halftone feel.
function DitherBars({ values = [], width = 240, height = 72, color = "currentColor", cell = 4, style = {} }) {
  const cols = Math.floor(width / cell);
  const rows = Math.floor(height / cell);
  const max = Math.max(...values, 1);
  const per = cols / values.length;
  const dots = [];
  values.forEach((v, vi) => {
    const fill = (v / max);
    const xStart = Math.floor(vi * per);
    const xEnd = Math.floor((vi + 1) * per) - 1;
    for (let i = xStart; i <= xEnd; i++) {
      for (let j = rows - 1; j >= 0; j--) {
        const y01 = 1 - j / (rows - 1);
        if (y01 > fill + (dhash(i, j, vi + 1) - 0.5) * 0.12) continue;
        dots.push(<circle key={`${i}-${j}`} cx={i * cell + cell / 2} cy={j * cell + cell / 2} r={(cell / 2) * 0.9} fill={color} />);
      }
    }
  });
  return (
    <svg viewBox={`0 0 ${cols * cell} ${rows * cell}`} width="100%" height={height} style={style}>
      {dots}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// Grain overlay — generates a static-noise PNG once and uses as bg image.
// Wrapper absorbs clicks? No — pointer-events:none.
// ─────────────────────────────────────────────────────────────
let _grainUrl = null;
function grainUrl() {
  if (_grainUrl) return _grainUrl;
  const c = document.createElement("canvas");
  c.width = 180; c.height = 180;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(180, 180);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 180 + Math.random() * 75; // 180..255
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v;
    img.data[i + 3] = 14 + Math.random() * 14; // low alpha
  }
  ctx.putImageData(img, 0, 0);
  _grainUrl = c.toDataURL("image/png");
  return _grainUrl;
}
function Grain({ opacity = 0.5, blend = "multiply", style = {} }) {
  const url = typeof document !== "undefined" ? grainUrl() : "";
  return (
    <div style={{
      position: "absolute", inset: 0, pointerEvents: "none",
      backgroundImage: `url(${url})`,
      backgroundSize: "180px 180px",
      mixBlendMode: blend,
      opacity,
      ...style,
    }} />
  );
}

// Sparkline line chart (mono accent)
function Sparkline({ data = [], accent = "currentColor", width = "100%", height = 40, strokeWidth = 2, showDots = false, fillOpacity = 0, style = {} }) {
  const w = 100, h = 30;
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = w / (data.length - 1 || 1);
  const pts = data.map((v, i) => [i * step, h - ((v - min) / range) * h]);
  const d = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
  const area = `${d} L${pts[pts.length - 1][0]},${h} L0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={width} height={height} preserveAspectRatio="none" style={style}>
      {fillOpacity > 0 && <path d={area} fill={accent} opacity={fillOpacity} />}
      <path d={d} fill="none" stroke={accent} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      {showDots && pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={1.6} fill={accent} />)}
    </svg>
  );
}

// Bar chart
function Bars({ data = [], accent = "currentColor", track = "rgba(0,0,0,0.08)", height = 56, style = {} }) {
  const max = Math.max(...data.map((d) => d.n || d.v || 0), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height, ...style }}>
      {data.map((d, i) => {
        const v = d.n ?? d.v ?? 0;
        const h = (v / max) * 100;
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 4 }}>
            <div style={{ flex: 1, display: "flex", alignItems: "flex-end", background: track, borderRadius: 2, overflow: "hidden" }}>
              <div style={{ width: "100%", height: `${h}%`, background: accent }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Status pill
function Pill({ children, tone = "default", mono = false, style = {} }) {
  const tones = {
    default: { bg: "rgba(0,0,0,0.06)", fg: "inherit" },
    accent:  { bg: "var(--accent-dim)", fg: "var(--accent)" },
    solid:   { bg: "var(--accent)", fg: "var(--accent-on)" },
    warn:    { bg: "rgba(234,88,12,0.12)", fg: "#b45309" },
    ok:      { bg: "rgba(4,120,87,0.12)", fg: "#047857" },
    muted:   { bg: "rgba(0,0,0,0.04)", fg: "var(--muted-fg)" },
  };
  const t = tones[tone] || tones.default;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 999, fontSize: 10.5, fontWeight: 600,
      background: t.bg, color: t.fg, letterSpacing: mono ? 0 : 0.2,
      fontFamily: mono ? 'var(--mono)' : 'inherit',
      textTransform: mono ? 'none' : 'uppercase',
      whiteSpace: "nowrap",
      ...style,
    }}>{children}</span>
  );
}

// Delta arrow + value
function Delta({ value, invert = false, style = {} }) {
  const n = typeof value === "string" ? parseFloat(value) : value;
  const up = n > 0;
  const good = invert ? !up : up;
  const color = good ? "var(--good)" : (n === 0 ? "var(--muted-fg)" : "var(--bad)");
  const sign = up ? "↑" : n < 0 ? "↓" : "·";
  return (
    <span style={{ fontFamily: "var(--mono)", fontSize: 11, color, ...style }}>
      {sign} {typeof value === "string" ? value.replace(/^[-+]/, "") : Math.abs(n)}
    </span>
  );
}

// Tiny mono overline label ("[ LABEL ]")
function MonoLabel({ children, style = {} }) {
  return (
    <span style={{
      fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: 0.6,
      textTransform: "uppercase", color: "var(--muted-fg)",
      ...style,
    }}>{children}</span>
  );
}

Object.assign(window, { DitherField, DitherDisc, DitherBars, Grain, Sparkline, Bars, Pill, Delta, MonoLabel, grainUrl });

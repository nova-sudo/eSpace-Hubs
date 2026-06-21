/**
 * Deterministic halftone dot field — the brand's signature texture.
 *
 * Ported from .design-reference/primitives.jsx (Nothing UI).
 *
 * Cross-engine determinism: `Math.sin` isn't bit-stable across V8 builds
 * (Node vs Chrome), so server-rendered radii drift from client-rendered by
 * ~1e-12, and React flags a hydration mismatch and stops reconciling the
 * whole tree. Every numeric attribute emitted here is rounded to 3 decimals
 * (sub-pixel — visually identical) so SSR and CSR agree byte-for-byte.
 */

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function dhash(x, y, seed = 1) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + seed * 43.7) * 43758.5453;
  return s - Math.floor(s);
}

export function DitherField({
  width = 240,
  height = 140,
  cell = 8,
  color = "currentColor",
  /** (u, v) in 0..1 → density in 0..1 */
  falloff = (u) => 1 - u,
  jitter = 0.35,
  seed = 7,
  className,
  style,
}) {
  const cols = Math.floor(width / cell);
  const rows = Math.floor(height / cell);
  const dots = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const u = i / (cols - 1);
      const v = j / (rows - 1);
      const d = Math.max(
        0,
        Math.min(1, falloff(u, v) + (dhash(i, j, seed) - 0.5) * jitter),
      );
      if (d < 0.05) continue;
      const r = round3((cell / 2) * 0.95 * d);
      dots.push(
        <circle
          key={`${i}-${j}`}
          cx={i * cell + cell / 2}
          cy={j * cell + cell / 2}
          r={r}
          fill={color}
        />,
      );
    }
  }
  return (
    <svg
      viewBox={`0 0 ${cols * cell} ${rows * cell}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {dots}
    </svg>
  );
}

export function DitherDisc({
  size = 220,
  cell = 6,
  color = "currentColor",
  density = 0.85,
  seed = 3,
  className,
  style,
}) {
  const n = Math.floor(size / cell);
  const dots = [];
  const cx = (n * cell) / 2;
  const cy = (n * cell) / 2;
  const R = (n * cell) / 2;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = i * cell + cell / 2;
      const y = j * cell + cell / 2;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) / R;
      if (dist > 1) continue;
      const rn = dhash(i, j, seed);
      const edge = Math.max(0, 1 - Math.pow(dist, 3));
      const d = edge * (density * (0.55 + rn * 0.5));
      if (d < 0.2) continue;
      const r = round3((cell / 2) * 0.92 * d);
      dots.push(
        <circle key={`${i}-${j}`} cx={x} cy={y} r={r} fill={color} />,
      );
    }
  }
  return (
    <svg
      viewBox={`0 0 ${n * cell} ${n * cell}`}
      width={size}
      height={size}
      className={className}
      style={style}
      aria-hidden="true"
    >
      {dots}
    </svg>
  );
}

export function DitherBars({
  values = [],
  width = 240,
  height = 72,
  color = "currentColor",
  cell = 4,
  style,
  className,
}) {
  const cols = Math.floor(width / cell);
  const rows = Math.floor(height / cell);
  const max = Math.max(...values, 1);
  const per = cols / Math.max(values.length, 1);
  const dots = [];
  values.forEach((v, vi) => {
    const fill = v / max;
    const xStart = Math.floor(vi * per);
    const xEnd = Math.floor((vi + 1) * per) - 1;
    for (let i = xStart; i <= xEnd; i++) {
      for (let j = rows - 1; j >= 0; j--) {
        const y01 = 1 - j / (rows - 1);
        if (y01 > fill + (dhash(i, j, vi + 1) - 0.5) * 0.12) continue;
        dots.push(
          <circle
            key={`${i}-${j}`}
            cx={i * cell + cell / 2}
            cy={j * cell + cell / 2}
            r={round3((cell / 2) * 0.9)}
            fill={color}
          />,
        );
      }
    }
  });
  return (
    <svg
      viewBox={`0 0 ${cols * cell} ${rows * cell}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      style={style}
      className={className}
      aria-hidden="true"
    >
      {dots}
    </svg>
  );
}

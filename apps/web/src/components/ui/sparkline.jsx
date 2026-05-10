/**
 * Tiny SVG line chart — optional area fill + dots.
 * Used by MergedTile and ReviewsTile.
 */
export function Sparkline({
  data = [],
  color = "currentColor",
  height = 40,
  strokeWidth = 2,
  showDots = false,
  fillOpacity = 0,
  className,
  style,
}) {
  if (data.length < 2) return null;
  const w = 100;
  const h = 30;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => [i * step, h - ((v - min) / range) * h]);
  const d = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
  const area = `${d} L${pts[pts.length - 1][0]},${h} L0,${h} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {fillOpacity > 0 ? <path d={area} fill={color} opacity={fillOpacity} /> : null}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showDots
        ? pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={1.6} fill={color} />)
        : null}
    </svg>
  );
}

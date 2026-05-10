/**
 * Plain bar chart — flex-based, tracks + fills.
 * Used for turnaround histogram and the non-dithered activity view.
 */
export function Bars({
  data = [],
  color = "var(--accent)",
  track = "var(--accent-dim)",
  height = 56,
  className,
  style,
}) {
  const max = Math.max(...data.map((d) => d.n ?? d.v ?? 0), 1);
  return (
    <div
      className={className}
      style={{ display: "flex", alignItems: "flex-end", gap: 4, height, ...style }}
    >
      {data.map((d, i) => {
        const v = d.n ?? d.v ?? 0;
        const h = (v / max) * 100;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "flex-end",
              background: track,
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div style={{ width: "100%", height: `${h}%`, background: color }} />
          </div>
        );
      })}
    </div>
  );
}

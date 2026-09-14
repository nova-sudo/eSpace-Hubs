/**
 * Plain bar chart — flex-based, tracks + fills.
 * Used for turnaround histograms and other small inline bar charts.
 *
 * Colors default to tokens: ink for the primary series, card-alt for the
 * track. Pass `d.highlight` on a data point to render it in lav instead.
 * `showValues` prints the value above each bar at 11px/700.
 */
export function Bars({
  data = [],
  color = "var(--ink)",
  track = "var(--card-alt)",
  height = 56,
  showValues = false,
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
        const fill = d.highlight ? "var(--lav)" : color;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 3,
              height: "100%",
            }}
          >
            {showValues ? (
              <span
                className="font-bold leading-none"
                style={{ fontSize: 11, color: d.highlight ? "var(--lav-ink)" : "var(--fg)" }}
              >
                {v}
              </span>
            ) : null}
            <div
              style={{
                width: "100%",
                display: "flex",
                alignItems: "flex-end",
                background: track,
                borderRadius: 4,
                overflow: "hidden",
                flex: 1,
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: `${h}%`,
                  background: fill,
                  borderTopLeftRadius: 4,
                  borderTopRightRadius: 4,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * ↑ / ↓ / · prefix + absolute value, colored by sign.
 * Set `invert` for metrics where lower is better (turnaround, rounds).
 */
export function Delta({ value, invert = false, className }) {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(n)) return null;
  const up = n > 0;
  const good = invert ? n < 0 : n > 0;
  const color =
    n === 0 ? "var(--muted-fg)" : good ? "var(--good)" : "var(--bad)";
  const sign = up ? "↑" : n < 0 ? "↓" : "·";
  const display = typeof value === "string" ? value.replace(/^[-+]/, "") : Math.abs(n);
  return (
    <span
      className={className}
      style={{ fontFamily: "var(--font-mono)", fontSize: 11, color }}
    >
      {sign} {display}
    </span>
  );
}

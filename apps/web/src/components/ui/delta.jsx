import { Badge } from "./badge";

/**
 * Renders a value change as a mint (good) / peach (bad) / neutral Badge
 * with a `+`/`−` sign. Set `invert` for metrics where lower is better
 * (turnaround, review rounds).
 */
export function Delta({ value, invert = false, className }) {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(n)) return null;
  const good = invert ? n < 0 : n > 0;
  const tone = n === 0 ? "neutral" : good ? "mint" : "peach";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  const display = typeof value === "string" ? value.replace(/^[-+]/, "") : Math.abs(n);
  return (
    <Badge tone={tone} className={className}>
      {sign}
      {display}
    </Badge>
  );
}

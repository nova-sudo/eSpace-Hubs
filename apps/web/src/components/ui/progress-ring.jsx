/**
 * A circular progress meter. Used where a tile has to carry one number and
 * nothing else — the goals overview, an objective's contribution to the year.
 *
 * `weight` thickens the stroke instead of printing a percentage beside the
 * title: a 40%-of-the-year objective reads as heavier without a second number
 * competing with the one in the middle.
 */
export function ProgressRing({
  value = 0,
  size = 52,
  weight = null,
  label,
  children,
  className,
}) {
  const pctValue = Math.max(0, Math.min(100, Number(value) || 0));
  // 4px at no weight, up to 8px at 40%+ — the range the eye reads as "thicker"
  // without the ring closing on itself.
  const stroke = weight == null ? 5 : weight >= 40 ? 8 : weight >= 20 ? 6 : 4;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - pctValue / 100);

  return (
    <div
      className={className}
      style={{ position: "relative", width: size, height: size, flexShrink: 0 }}
      role="img"
      aria-label={label || `${Math.round(pctValue)} percent`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--card-alt)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference.toFixed(2)}
          strokeDashoffset={offset.toFixed(2)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {children != null ? (
        <span
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: Math.round(size * 0.26),
            fontWeight: 800,
            letterSpacing: "-0.02em",
            fontVariantNumeric: "tabular-nums",
            color: "var(--fg)",
          }}
        >
          {children}
        </span>
      ) : null}
    </div>
  );
}

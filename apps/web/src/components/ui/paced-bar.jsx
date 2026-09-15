/**
 * A progress bar with a pacing tick — the grey mark showing where the cycle
 * says you should be by now.
 *
 * A bare percentage is unreadable without it: 40% is triumphant in February
 * and a disaster in November. Every serious goal tracker draws this; it is
 * also what stops an AI-assigned tier looking arbitrary, because the user can
 * see the gap the grader was reasoning about.
 *
 * `expected` defaults to how far through the calendar year today is, which is
 * the cycle this product uses everywhere.
 */
export function PacedBar({
  value = 0,
  expected = null,
  height = 6,
  tone = "var(--ink)",
  className,
}) {
  const pctValue = Math.max(0, Math.min(100, Number(value) || 0));
  const pctExpected =
    expected == null ? yearElapsedPercent() : Math.max(0, Math.min(100, Number(expected) || 0));

  return (
    <span
      className={className}
      style={{
        position: "relative",
        display: "block",
        height,
        borderRadius: "var(--radius-pill)",
        background: "var(--card-alt)",
      }}
    >
      <span
        style={{
          display: "block",
          height: "100%",
          width: `${pctValue}%`,
          borderRadius: "var(--radius-pill)",
          background: tone,
        }}
      />
      <span
        aria-hidden="true"
        title={`Expected by now: ${Math.round(pctExpected)}%`}
        style={{
          position: "absolute",
          top: -2,
          bottom: -2,
          left: `${pctExpected}%`,
          width: 2,
          borderRadius: 2,
          background: "var(--dim-fg)",
        }}
      />
    </span>
  );
}

/** How far through the calendar year we are, 0–100. */
export function yearElapsedPercent(now = Date.now()) {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const end = Date.UTC(d.getUTCFullYear() + 1, 0, 1);
  return ((now - start) / (end - start)) * 100;
}

/**
 * 3×3 dot-matrix logo glyph — the Nothing UI signature mark. A bordered
 * card square holding nine dots: corners solid ink (--dot), edges faint
 * (--dot-dim), centre the cobalt accent. Theme-aware via tokens.
 */
export function LogoMark({ size = 26 }) {
  const dot = (bg, key) => (
    <i key={key} style={{ background: bg, borderRadius: "50%" }} />
  );
  const D = "var(--dot)";
  const F = "var(--dot-dim)";
  const A = "var(--accent)";
  const pattern = [D, F, D, F, A, F, D, F, D];
  return (
    <span
      aria-label="eSpace DevHub logo"
      style={{
        width: size,
        height: size,
        borderRadius: "var(--radius-sub)",
        border: "1px solid var(--border-strong)",
        background: "var(--card)",
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gridTemplateRows: "repeat(3, 1fr)",
        gap: 2.5,
        padding: 5,
        flexShrink: 0,
      }}
    >
      {pattern.map((bg, i) => dot(bg, i))}
    </span>
  );
}

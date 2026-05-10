/**
 * Hexagonal logo mark — 3 concentric rings of dots + 1 centered dot.
 * Pure SVG, 26×26. Keep in accent color.
 */
export function LogoMark({ size = 26 }) {
  const cx = 13;
  const cy = 13;
  const dots = [];
  for (let ring = 1; ring <= 3; ring++) {
    for (let a = 0; a < 6; a++) {
      const ang = (a / 6) * Math.PI * 2 - Math.PI / 2;
      for (let s = 0; s < ring; s++) {
        const nextAng = ((a + 1) / 6) * Math.PI * 2 - Math.PI / 2;
        const t = s / ring;
        const x = cx + (Math.cos(ang) * (1 - t) + Math.cos(nextAng) * t) * ring * 3.6;
        const y = cy + (Math.sin(ang) * (1 - t) + Math.sin(nextAng) * t) * ring * 3.6;
        dots.push(
          <circle key={`${ring}-${a}-${s}`} cx={x} cy={y} r={1.4} fill="var(--accent)" />,
        );
      }
    }
  }
  dots.push(<circle key="center" cx={cx} cy={cy} r={1.6} fill="var(--accent)" />);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 26 26"
      aria-label="eSpace Dev Hub logo"
    >
      {dots}
    </svg>
  );
}

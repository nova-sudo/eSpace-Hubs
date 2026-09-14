/**
 * Plain geometric mark — an ink square with a smaller ink-on square
 * centred inside. No dot-matrix pattern, no per-hub accent.
 */
export function LogoMark({ size = 28 }) {
  return (
    <span
      aria-label="eSpace DevHub logo"
      className="grid shrink-0 place-items-center rounded-[9px] bg-ink"
      style={{ width: size, height: size }}
    >
      <span className="block rounded-[3px] bg-ink-on" style={{ width: size * (10 / 28), height: size * (10 / 28) }} />
    </span>
  );
}

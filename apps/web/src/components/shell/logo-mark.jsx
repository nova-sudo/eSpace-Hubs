/**
 * The hub-cluster mark: three tiles on a rounded plate, the fourth slot
 * left open. Drawn on the brand kit's 64-unit grid (plate rx 20.57, tiles
 * 13×13 rx 4 at 16,16 lead / 35,16 / 16,35) so it matches the exported
 * assets in `public/brand/` exactly.
 *
 * Mono in both themes, from one component: the plate is `--ink` and the
 * tiles are `--ink-on`, so light paints dark-plate/light-tiles and dark
 * paints the inverse with no second asset and no theme branching.
 */
export function LogoMark({ size = 28, className }) {
  return (
    <svg
      role="img"
      aria-label="eSpace Hubs logo"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      style={{ display: "block", flexShrink: 0 }}
    >
      <rect width="64" height="64" rx="20.57" fill="var(--ink)" />
      {/* Lead tile — full strength. */}
      <rect x="16" y="16" width="13" height="13" rx="4" fill="var(--ink-on)" />
      {/* Supporting tiles. The fourth slot (35,35) stays empty by design. */}
      <rect x="35" y="16" width="13" height="13" rx="4" fill="var(--ink-on)" opacity="0.55" />
      <rect x="16" y="35" width="13" height="13" rx="4" fill="var(--ink-on)" opacity="0.55" />
    </svg>
  );
}

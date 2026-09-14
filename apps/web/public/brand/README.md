# eSpace Hubs — Hub cluster mark

Geometry: 64-unit grid. Plate rx 20.57 (= 9px at 28px, matching the previous
LogoMark). Three 13x13 tiles, rx 4, at (16,16) lead / (35,16) / (16,35);
the fourth slot stays open.

Colors (apps/web/src/app/globals.css):
  plate  --sky-ink  #1e3a8a
  tiles  --sky      #e0eafe
  lead   --ink-on   #ffffff
  wordmark --fg     #18181b  /  "Hubs" --muted-fg #71717a

## Vector
mark-color.svg        primary, light and dark canvases
mark-on-dark.svg      inverted plate for dark surfaces
mark-ink.svg          single-color ink plate
mark-white.svg        white plate, for dark/photo grounds
mark-black.svg        pure black, for print one-color
glyph-color.svg       tiles only, transparent plate
glyph-ink.svg         tiles only, ink
favicon.svg           tighter inset + larger tiles; use at <= 24px
favicon-ink.svg       mono favicon cut
lockup-color.svg      horizontal lockup, mark 40 + 14px gap
lockup-on-dark.svg    horizontal lockup for dark
lockup-ink.svg        mono horizontal lockup
lockup-stacked-color.svg

Note: the lockup SVGs set text in Manrope by name. Where Manrope is not
available (email clients, some design tools), use the PNG lockups in
png/ or convert the text to outlines on export.

## Raster (png/)
favicon-16/32/48.png        browser tab
mark-64/128/256.png         general UI
mark-180.png                apple-touch-icon
mark-192.png, mark-512.png  PWA manifest
mark-1024.png               store listing
mark-ink-512.png, mark-white-512.png, mark-on-dark-512.png
lockup-color.png, lockup-on-dark.png, lockup-stacked.png  (3x, Manrope baked in)

## Clear space
One tile width (25% of the plate) on all sides. Minimum 16px using the
favicon cut; the standard mark holds down to 24px.

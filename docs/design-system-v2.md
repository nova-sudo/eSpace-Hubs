# DevHub design system v2 — "Zinc"

> The single contract for the UI redesign. Every component, page and hub
> follows this file. If something here conflicts with older comments in
> the code or with the "Nothing UI" notes in CLAUDE.md, THIS FILE WINS.
> Reference mockups: the "DevHub Redesign" canvas (Intelligence light +
> dark, Goals flow, Evidence, System sheet).

## 1. The idea in one paragraph

One sans family (Manrope), one brand color (zinc ink), five pastel tints
that carry state, borderless white cards at a 20px radius on a cool grey
canvas, pill-shaped navigation and buttons, sentence case everywhere.
Dark mode flips the surfaces but keeps the tints as pastel fills with
dark ink on top. No dot-matrix type, no mono labels, no uppercase
overlines, no dashed hairlines, no dither or grain textures, no hub
accent colors.

## 2. Tokens (`apps/web/src/app/globals.css`)

All values live as CSS variables and are mapped into Tailwind through
`@theme inline`. Never hard-code a hex in a component. The only allowed
literal colors are inside `features/evidence/pdf/` (the PDF renderer
cannot read CSS variables) and inside chart palette constants that are
explicitly named as such.

### Surfaces and text

| Token | Light | Dark | Tailwind | Use |
|---|---|---|---|---|
| `--bg` | `#f4f4f5` | `#0b0b0d` | `bg-bg` | page canvas |
| `--card` | `#ffffff` | `#17171a` | `bg-card` | every card |
| `--card-alt` | `#f7f7f8` | `#202024` | `bg-card-alt` | inset panels, soft buttons, resting inputs, chips on a card |
| `--fg` | `#18181b` | `#f4f4f5` | `text-fg` | primary text |
| `--muted-fg` | `#6d6d76` | `#a1a1aa` | `text-muted-fg` | secondary text, labels (4.66:1 on the canvas — AA) |
| `--dim-fg` | `#a1a1aa` | `#62626b` | `text-dim-fg` | placeholders ONLY — 2.56:1, below the AA body-text bar |
| `--line` | `rgba(24,24,27,.07)` | `rgba(255,255,255,.08)` | `border-line` | dividers INSIDE cards only |
| `--ink` | `#18181b` | `#f4f4f5` | `bg-ink` | the brand: primary buttons, active nav pill, filled progress |
| `--ink-on` | `#ffffff` | `#18181b` | `text-ink-on` | text on ink |
| `--shadow-card` | soft | none | (style) | resting card shadow in light only |
| `--shadow-float` | stronger | stronger | (style) | popovers, dialogs, dropdowns |

### Tints (state and category)

Each tint is a surface + ink pair. Values are IDENTICAL in light and dark.

| Tint | Surface | Ink | Tailwind | Meaning |
|---|---|---|---|---|
| mint | `--mint #dcf5e6` | `--mint-ink #14532d` | `bg-mint text-mint-ink` | good, on pace, achieved, positive delta |
| sky | `--sky #e0eafe` | `--sky-ink #1e3a8a` | `bg-sky text-sky-ink` | info, snapshots, system notices |
| lav | `--lav #e9e4ff` | `--lav-ink #3b1d8f` | `bg-lav text-lav-ink` | AI, role model, insight, auto widgets |
| peach | `--peach #ffe4d6` | `--peach-ink #9a3412` | `bg-peach text-peach-ink` | behind, overdue, not achieved, danger, negative delta |
| lemon | `--lemon #fbf3c4` | `--lemon-ink #713f12` | `bg-lemon text-lemon-ink` | waiting, not logged, needs setup, pending |

Semantic aliases exist so old code keeps resolving, but NEW code uses
the tint names directly: `--good` = mint-ink, `--warn` = lemon-ink,
`--bad` = peach-ink, `--good-bg` = mint, `--warn-bg` = lemon,
`--bad-bg` = peach, `--accent` = ink, `--accent-on` = ink-on,
`--accent-dim` = card-alt, `--accent-2` = mint-ink, `--border` = line.

### Radii

| Token | Value | Use |
|---|---|---|
| `--radius-xl` | 20px | cards, tiles, dialogs |
| `--radius-lg` | 14px | inset panels, inputs, tinted rows inside a card, insight rows |
| `--radius-md` | 10px | small chips inside rows, ladder cells, mini bars |
| `--radius-pill` | 999px | buttons, nav, badges, filter chips, segmented controls |

`--radius-tile` and `--radius-sub` still resolve (20px / 14px) for
untouched call sites, but new code uses the names above.

### Type

One family: **Manrope** (Google Fonts, weights 500 600 700 800).
`--font-sans` and `--font-display` both resolve to Manrope. `--font-mono`
is **JetBrains Mono** and is used ONLY for goal codes, ticket keys,
commit hashes, and code. Never for labels, buttons, captions or numbers.
`--font-dot` still resolves (to Manrope) so nothing crashes, but every
usage must be removed.

| Role | Size / weight / tracking | Class recipe |
|---|---|---|
| Display (page title) | 40px / 800 / -0.03em / lh 1.05 | `text-[40px] font-extrabold tracking-[-0.03em] leading-[1.05]` |
| Big numeral | 44–56px / 800 / -0.04em / lh 1 / tabular | `text-[56px] font-extrabold tracking-[-0.04em] leading-none tabular-nums` |
| Section title | 18px / 700 / -0.01em | `text-[18px] font-bold tracking-[-0.01em]` |
| Card title | 15px / 700 / lh 1.3 | `text-[15px] font-bold leading-[1.3]` |
| Row title | 14.5px / 700 | `text-[14.5px] font-bold` |
| Body | 14px / 500 / lh 1.5 | `text-[14px]` (body default) |
| Small body | 13px / 500 / lh 1.5 | `text-[13px]` |
| Label | 12px / 600 / muted | `text-[12px] font-semibold text-muted-fg` |
| Caption (rare, uppercase) | 11px / 700 / +0.06em / uppercase / muted | `text-[11px] font-bold tracking-[0.06em] uppercase text-muted-fg` |
| Badge text | 11.5px / 700 | inside `<Badge>` |

Sentence case everywhere. Uppercase only through the Caption recipe (the
`<Label caps>` primitive), and only for a stat's caption under a big
numeral. Never uppercase a button, a nav item, a title, or a badge.

### Spacing

4pt grid. Page gutter `px-4 sm:px-10`. Page top `pt-7`. Card padding
`p-5` (20px) for grid cards, `p-6`/`p-7` (24/28px) for a hero card.
Grid gap `gap-4` (16px). Stack gap inside a card `gap-3.5` (14px). Page
header bottom margin `mb-7`.

## 3. Primitives (`apps/web/src/components/ui`)

Always import from the barrel `@/components/ui`. Feature code never
edits `components/ui`. If a primitive is missing, build it with tokens
inline in the feature and note it in your report.

| Primitive | Props | Notes |
|---|---|---|
| `Button` | `variant` = `ink` (default) · `soft` · `tint` · `ghost` · `danger`; `size` = `sm` (36px) · `md` (40px) · `lg` (44px); `tone` (for `tint`) = mint · sky · lav · peach · lemon; `arrow` (bool, trailing mint circle with arrow, ink only); `iconOnly` | Pill shape. Sentence case. Manrope 700 for ink, 600 otherwise. Legacy `variant="primary"` and `"solid"` map to ink. Never uppercase, never mono. |
| `Card` | `tone` = none (white) · mint · sky · lav · peach · lemon · ink; `padding` (default 20); `radius` = xl (default) · lg; `className` | No border. `--shadow-card` in light. `tone="ink"` is the solid dark card. Legacy `variant="accent"` maps to `tone="ink"`. |
| `BentoTile` | unchanged API (`col`, `row`, `label`, `title`, `right`, `variant`) | Thin wrapper over Card. `variant="accent"` renders `tone="ink"`. Label renders through `<Label>`. |
| `Badge` (alias `Pill`) | `tone` = neutral (default) · mint · sky · lav · peach · lemon · ink; `dot` (bool, leading 6px dot in currentColor); `className` | 11.5px 700, pill, `px-2.5 py-1`, sentence case. Legacy tones: `ok`/`good` → mint, `warn` → lemon, `bad` → peach, `accent` → lav, `solid` → ink, `default`/`muted` → neutral. `mono` prop is ignored. |
| `Label` (alias `MonoLabel`) | `caps` (bool); `as`; `className` | 12px 600 muted sentence case; `caps` gives the Caption recipe. Never mono. |
| `Stat` | `label`, `value`, `unit`, `delta`, `deltaInvert`, `sub`, `size` = md (44px) · lg (56px) | Numeral in Manrope 800 tabular. Delta renders as a mint/peach `Badge`. |
| `Delta` | `value`, `invert` | Renders as a mint (good) / peach (bad) / neutral `Badge` with `+`/`−` sign. No arrows. |
| `PageHeader` | `crumb`, `title`, `subtitle`, `right` | Crumb = Label. Title = Display recipe. `italicWord` is accepted and ignored. Optional GSAP reveal kept. |
| `Section` | `title`, `right`, `children`, `className` | Section-title recipe with `mb-3.5`. No rule line. `num` is accepted and ignored. |
| `SegmentedControl` | `options: [{value,label,count?}]`, `value`, `onChange`, `size` = sm · md | Pill track in `bg-card` (or `bg-card-alt` on a card), active item = ink pill. |
| `FilterChip` | `label`, `value`, `icon`, `onClick`, `active`, `count` | 40px pill: `Label: Value ▾`. |
| `InsightRow` | `children`, `action: {label, href?, onClick?}`, `tone` = neutral · lav | Sparkle icon (lavender ink) + one line + one link. Sits at the bottom of a card. |
| `FillStrip` | `cells: [{state: filled · owed · current · future · settled, label?}]`, `size` = sm (6px) · md (10px) · row (8×16 cells) | filled = ink, owed = peach-ink at 55%, current = card-alt with a dashed dim outline, future = card-alt, settled = card-alt at 60%. |
| `Input`, `Field`, `Select`, `Checkbox` | as today | Filled `bg-card-alt`, `--radius-lg`, 44px, no border at rest, 2px ink ring on focus. Field label = `<Label>`. Select popup = card with `--shadow-float`. |
| `IconButton` | `label` (aria), `size` = sm (32) · md (38); `children` = a lucide icon | Circle, `bg-card` on the canvas, `bg-card-alt` on a card. |
| `Loader`, `Loading`, `TileState` | as today | Loader is a plain 3-dot pulse or ring in currentColor. No dot-matrix library. |
| `Bars`, `Sparkline`, `LineSpark`, `ContributionHeatmap` | as today | Bars: rounded 8/8/4/4 tops, highlighted bar = lav with the value printed on it. Lines: ink stroke, soft gradient fill. Colors only from tokens. |
| `Reveal`, `useFocusTrap`, `StarGlyph`, `ItemEvidence` | as today | Restyled to tokens. |

Removed and must not be imported anywhere: `DitherField`, `DitherDisc`,
`DitherBars`, `Grain`, `GlyphAgent`.

## 4. Shell (`apps/web/src/components/shell`)

- Header: 72px tall, canvas background, no border. Left: a 28px ink
  rounded square + "DevHub" 17px 800. Center: nav as pills, active =
  `bg-ink text-ink-on`, inactive = `text-fg` with `hover:bg-card`.
  Right: circular `IconButton`s (search opens the command palette, bell
  with a peach-ink dot) and the user chip as a `bg-card` pill with a
  lavender avatar, name, hub badge and chevron. Theme toggle stays as a
  circular icon button. Mobile: hamburger + stacked pill list.
- No version tag in the header. No `⌘K` chip (the search button is the
  affordance).
- Footer: 12.5px muted, no top border, `mt-8 py-4`.
- AppShell: no `<Grain>`. Everything else unchanged.

## 5. Patterns

**Page header.** Crumb (Label) → Display title → optional subtitle
(14.5px muted, max-w 560) on the left; actions (FilterChips, a
SegmentedControl, primary Button) on the right, bottom-aligned.

**Card.** White, no border, 20px radius, `p-5`. A card's internal
sections are separated by `border-t border-line`, never by boxes.

**Tinted card / row.** A `Card tone="peach"` (or a `rounded-[var(--radius-lg)]
bg-peach text-peach-ink p-3.5` row inside a white card) is how a status
becomes a surface. The text on a tint is ALWAYS the tint's ink.

**Badge.** One per row, right-aligned, sentence case. A `dot` badge for
live status, no dot for grade/tier.

**Insight row.** At the bottom of a card: sparkle + one sentence + one
link. AI text is always marked with the sparkle.

**Fill strip.** Cadence windows as rounded pills or 8×16 cells. Ink =
filled, peach = owed, dashed = current. Labels in 11.5px dim under it.

**Buttons.** One ink button per view. Secondary actions are `soft`.
Destructive actions are `danger` (peach tint), never red-outlined.

**Empty state.** Inside a white card: 15px 700 title, 13px muted body,
one soft or ink button. No dashed border.

**Dialogs / modals / drawers.** `bg-card`, `--radius-xl`, `--shadow-float`,
`p-6`, backdrop `bg-fg/40`. Title = Section-title recipe.

**Tables.** Header row = Label recipe (sentence case) with
`border-b border-line`; rows `border-t border-line`; no zebra.

**Charts.** Ink for the primary series, lav for the highlighted item,
card-alt for context bars, mint/peach only for good/bad deltas. Value
labels printed on the bar (11px 700). No dot fields, no dither.

## 6. Forbidden → replacement

| Forbidden | Replace with |
|---|---|
| `fontFamily: "var(--font-dot)"`, `font-dot`, `em.accent`, `italicWord` | Display or numeral recipe in Manrope |
| `fontFamily: "var(--font-mono)"` on labels/buttons/captions | Label / Caption recipe. Keep `font-mono` only for codes and hashes |
| `uppercase tracking-[…]` on anything but a Caption | sentence case |
| `border-dashed`, `border-b border-border` rules under titles | no rule, or `border-t border-line` inside a card |
| `border border-border` around a card | no border |
| `bg-accent-dim`, `text-accent`, `border-accent`, `var(--accent)` | `bg-card-alt` for surfaces; `text-fg` for links (700 weight); `bg-lav text-lav-ink` for AI/highlight; `bg-ink` for the primary |
| `text-good` / `text-warn` / `text-bad` as text colors | a Badge, or `text-mint-ink` / `text-lemon-ink` / `text-peach-ink` ONLY on a matching tint surface. Semantic color on white text is not used; the surface carries the state |
| `rounded-md`, `rounded-[4px]`, `rounded-[6px]`, `rounded-lg` (8px) | `rounded-[var(--radius-md)]` or larger |
| `DitherField`, `DitherDisc`, `DitherBars`, `Grain`, `GlyphAgent`, dot-grid `radial-gradient` textures | delete |
| Raw hex outside `pdf/` and named chart palettes | tokens |
| `↑ ↓ → ▾ ▴ ·` used as icons in text | lucide icons (`ArrowRight`, `ChevronDown`, …) at 14–16px; the middle dot `·` is allowed as a text separator |
| `Pill` | `Badge` |
| `MonoLabel` | `Label` |
| Section headers with `num="01"` | `Section title=…` |

## 7. Migration procedure per file

1. Read the whole file first.
2. Replace imports: `Pill` → `Badge`, `MonoLabel` → `Label`, remove the
   deleted primitives.
3. Delete every inline `style={{ fontFamily: … }}`.
4. Replace every uppercase/mono label with the Label recipe.
5. Replace every bordered card with the Card primitive or the card
   recipe (`rounded-[var(--radius-xl)] bg-card p-5`, shadow via
   `style={{ boxShadow: "var(--shadow-card)" }}` when it is not a
   `<Card>`).
6. Map colors: accent → ink/lav, good → mint, warn → lemon, bad → peach.
7. Map radii to xl/lg/md/pill.
8. Replace text glyph icons with lucide icons.
9. Keep all logic, hooks, data flow, aria attributes, keyboard handling,
   test ids and copy intact. This is a visual migration, not a rewrite.
   Do not rename exports, do not change props consumed by other
   features, do not touch stores, hooks or metrics files unless they
   contain JSX.
10. Run the guard grep for your files (section 8) until it is clean.

## 8. Guard (must stay clean)

`apps/web/src/design-system-guard.test.js` walks `src/` and fails on:
`font-dot`, `--font-dot`, `--dot`, `DitherField`, `DitherDisc`,
`DitherBars`, `<Grain`, `GlyphAgent`, `italicWord=`, `border-dashed`,
inline `fontFamily:`, `text-[9px]`, `text-[10px]`, `text-[10.5px]`,
and raw 6-digit hex outside `features/evidence/pdf/` and
`*-palette.js`. Run it with:

```
npx tsx --test src/design-system-guard.test.js
```

Quick manual check for a folder:

```
grep -rnE "font-dot|--dot|Dither|<Grain|GlyphAgent|italicWord|border-dashed|fontFamily:|text-\[(9|10|10\.5)px\]|#[0-9a-fA-F]{6}\b" <folder>
```

## 9. Removed surfaces

- The marketing landing page (`features/landing`) is deleted. `/` for a
  signed-out visitor redirects to `/login`. Signed-in users still go to
  their hub.
- The analyst "GLYPH" face (`GlyphAgent`, `glyph-moods.js`, the dark
  instrument rail and its `--glyph-*` tokens) is deleted. The analyst
  page becomes a normal themed overlay: a white card workspace with a
  left column of mode pills (Widgets / Analysis / Review / Chat) and the
  same content, all in tokens.
- Per-hub accent skins (`[data-hub="manager"]` overrides, the registry
  `theme.accent` colors) are no longer applied. Hubs differ by content,
  not by color.

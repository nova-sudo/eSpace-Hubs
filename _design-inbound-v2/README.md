# Handoff: eSpace DevHub — Sectioned Dashboard

## Overview

A full-viewport scroll-snap dashboard for **eSpace DevHub** — a "receipts-ready" performance dashboard that pulls Jira + GitLab + GitHub into one calm, editorial view. The main navigation metaphor is a **4-section vertical scroll** with a minimalist right-side rail (6 px bubbles with hover/active tooltips) driven by `IntersectionObserver`.

The four sections are:

| # | Section | Content |
|---|---|---|
| 01 | **Overview** | Hero headline + live "Signal · 14D" tile + a 4-tile **At-a-glance** metric grid (Integrations · Merged · Review rounds · Jira↔MR linkage) |
| 02 | **At a glance & on your plate** | "Needs your attention" 3-card band + Tickets kanban (In flight · Queued · Shipped) + Open PRs / linked commits tile |
| 03 | **Goals & evidence** | 4-column L1/L2 performance goals tree + Snapshots · Export panel · Recent commits |
| 04 | **Trends** | Activity area chart + Turnaround histogram + Reviews-given list |

## About the Design Files

The files in this bundle are **design references created in HTML** — a single-page prototype showing intended look, behavior, and section rhythm. They are **not production code to copy directly**.

The task is to **recreate these designs in the target codebase's existing environment** (the attached `espace-devhub` app is a Next.js / React + Tailwind project under `src/app/`), using its established patterns, components, and design-token file (`src/app/globals.css`). If a token name or component does not yet exist in the codebase, create it following the same conventions as neighbouring files.

## Fidelity

**High-fidelity (hifi).** Every color, font size, border-radius, spacing value, hover state, and copy string in the mock is deliberate and should be reproduced pixel-perfectly. The aesthetic name used in the CSS is **"HexaCore"** — a warm-paper neutral (`#f1eee6`) background, pure-white cards, a single indigo accent (`#3826ff`), italic-serif section numbers, and a JetBrains-Mono micro-label system.

---

## Design Tokens

All tokens below are defined as CSS custom properties in `:root` and should be lifted into the codebase's existing token file.

### Color

| Token | Value | Use |
|---|---|---|
| `--bg` | `#f1eee6` | Page background (warm paper) |
| `--fg` | `#0b0b14` | Primary text |
| `--card` | `#ffffff` | Tile / card background |
| `--card-alt` | `#faf8f2` | Nested card, input background |
| `--muted-fg` | `rgba(11,11,20,0.55)` | Secondary text |
| `--dim-fg` | `rgba(11,11,20,0.38)` | Tertiary / meta text |
| `--border` | `rgba(10,11,22,0.10)` | Hairline borders |
| `--border-strong` | `rgba(10,11,22,0.18)` | Hover / emphasis borders |
| `--accent` | `#3826ff` | Primary indigo — links, active pills, accent tiles |
| `--accent-on` | `#ffffff` | Foreground on accent fill |
| `--accent-dim` | `rgba(56,38,255,0.10)` | Active-state wash, pill fills |
| `--accent-2` | `#00c48a` | Live / OK green |
| `--good` | `#047857` | Success text |
| `--bad` | `#b91c1c` | Error text |

### Typography

| Role | Family | Import |
|---|---|---|
| Display / sans | `"Inter Tight", "Inter", system-ui, sans-serif` | Google Fonts — weights 400, 500, 600, 700 |
| Mono | `"JetBrains Mono", "SF Mono", Menlo, monospace` | Google Fonts — weights 400, 500, 600, 700 |
| Serif accent | `ui-serif, "Iowan Old Style", Georgia, serif` | System — used **only** italic for section numbers and hero-accent word |

Font-feature settings on `body`: `"cv02","cv03","cv04","cv11","ss01"` (Inter stylistic set).

**Type scale:**

| Element | Size | Weight | Letter-spacing | Line-height |
|---|---|---|---|---|
| Hero h1 | `clamp(48px, 6.5vw, 92px)` | 600 | -2.5px | 0.94 |
| Section title | 22px | 600 | -0.5px | 1.2 |
| Section number (italic serif) | 22px | 500 | — | 1 |
| Tile title | 16–18px | 600 | -0.1px | 1.2 |
| Big stat | 56px | 600 | -2px | 1 |
| XL stat (Merged) | 96px | 600 | -4px | 0.9 |
| Body | 15px | 400 | — | 1.5 |
| Tile body | 12–13px | 400 | — | 1.35 |
| Mono labels | 10.5px | 400 | 0.6px, UPPERCASE | 1 |
| Micro mono | 9–10px | 700 | 0.4–0.6px, UPPERCASE | 1 |

### Spacing

The design uses an **implicit 2/4/6/8/10/12/14/18/24/36/40 px** rhythm:
- Section padding: `36px 40px 44px`
- Tile padding: `18px`
- Nested card padding: `12px` or `8px 10px`
- Grid gap: `14px`
- Stack gap (inside section): `18px`

### Radii

| Token | Value | Use |
|---|---|---|
| `--radius-tile` | `4px` | Tiles, main cards |
| `--radius-sub` | `3px` | Nested cards, buttons, chips, inputs |
| `--radius-pill` | `999px` | Pills, rail plate, avatar, bubbles |

### Borders

- All borders: 1px `var(--border)` by default.
- Attention band has a **3px left border** in `var(--accent)`.
- Tooltip arrow uses 1px `var(--border-strong)` on top/right for the rotated-square pointer.

### No shadows except…

This design is intentionally flat. The only shadow is on the rail tooltip:
```css
box-shadow: 0 2px 8px rgba(10,11,22,0.06);
```
And on the `.btn-export` hover:
```css
box-shadow: 0 4px 14px rgba(0,0,0,0.15);
```

### Grain overlay (optional, present in mock)

```css
.grain {
  position: fixed; inset: 0; pointer-events: none; z-index: 1;
  opacity: .35; mix-blend-mode: multiply;
  background-image: radial-gradient(rgba(10,11,22,0.3) 1px, transparent 1px);
  background-size: 3px 3px;
}
```

---

## Global Layout

```
┌──────────────────────────── header (sticky, 57px) ────────────────────────────┐
│ brand + nav (left)                                         LIVE + avatar (right) │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                    ●│           │
│                                                                    ●│ ← rail    │
│    SECTION (scroll-snap: start, min-height: calc(100vh - 57px))    ●│ (fixed)   │
│                                                                    ●│           │
│                                                           01 / 04  ─┘ ← counter│
└───────────────────────────────────────────────────────────────────────────────┘
```

- **Header** is `position: sticky; top: 0`, 57 px tall, `backdrop-filter: blur(18px)`, background `rgba(241,238,230,0.80)`.
- **Scroll root** is `height: calc(100vh - 57px); overflow-y: scroll; scroll-snap-type: y mandatory; scroll-behavior: smooth`. WebKit scrollbar hidden.
- **Each `.section`** has `scroll-snap-align: start; scroll-snap-stop: always; min-height: calc(100vh - 57px); padding: 36px 40px 44px; display: flex; flex-direction: column; gap: 18px`. Sections are allowed to exceed 100vh — they scroll internally before snapping to the next.
- **Rail** is `position: fixed; right: 18px; top: 50%; translateY(-50%)`. A rounded pill plate with backdrop-blur contains the 4 bubble buttons.
- **Section counter** is `position: fixed; right: 18px; bottom: 18px` — shows `<current> / 04` with the current number in accent.

---

## Section Rail (the signature interaction)

The rail is the key navigation pattern. It must match the mock exactly.

**Structure:**
```html
<nav class="rail">
  <button class="rail-item" data-target="sec-overview">
    <span class="rail-bubble"></span>
    <span class="rail-tip"><span class="hash">#</span>overview</span>
  </button>
  <!-- …one button per section… -->
</nav>
```

**Visual states:**

| State | Bubble | Tooltip |
|---|---|---|
| Rest | `6×6 px`, `background: var(--border-strong)` | hidden (`opacity: 0`) |
| Hover | `9×9 px`, `background: var(--muted-fg)` | visible, slides in from right |
| Active | `8×8 px`, `background: var(--accent)`, `box-shadow: 0 0 0 3px var(--accent-dim)` (soft halo) | visible |

Tooltip pill appears to the **left** of the dot, with a small rotated-square pointer on the right edge. The `#` prefix in the tooltip is rendered in accent color.

**Behavior:**
- Clicking a bubble smooth-scrolls to its section.
- An `IntersectionObserver` on the scroll root (`threshold: [0.25, 0.5, 0.75]`) toggles `.active` on the bubble whose section has the highest intersection ratio, and updates the `<current> / 04` counter.

---

## Screens / Views (by section)

### SECTION 01 — Overview

**Layout:**
```
┌── HERO (2-col grid) ───────────────────────────────────────────────────────┐
│ [mono subtitle]                                                             │
│ h1 headline  (italic-serif "case" word is accent)         ┌──── SIGNAL ───┐│
│ body paragraph, max-width 620px                           │ 312  tracked  ││
│                                                            │ (dither fill) ││
│                                                            └───────────────┘│
├── TOOLBAR (range chips) ────────────────────────────────────────────────────┤
├── GLANCE GRID (12-col, 150px row height, 2 rows) ─────────────────────────┐
│ [Integrations (3 col × 2 row)] [Merged accent (4 col × 2 row)]             │
│ [Rounds (2 col × 2 row)] [Linkage (3 col × 2 row)]                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Hero copy (exact):**
- Mono subtitle: `Wk 17 · Apr 20 — Apr 26 · L1 → L2 track`
- h1: `Measure. Merge. Make the <em>case</em>.` (first two words dim, "case" italic-serif accent)
- Body: `A quiet dashboard for loud performance seasons. Pulls your Jira, GitLab and GitHub into one receipts-ready view — so review time writes itself.`

**Signal tile:**
- 280×180, white card, 1px border
- Big number `312`, mono label `events / tracked` to the right
- Right half filled by `dither-signal.svg` masked with left-to-right gradient (`-webkit-mask-image: linear-gradient(to left, #000 40%, transparent)`)

**Toolbar:** range chips — `7D` · `This week` (active) · `30D` · `90D` · `Qtr` — mono typography, active state = `accent-dim` bg + accent fg.

**Glance tiles (row: 150px, gap 14px, grid-auto-rows: 150px, grid-row: span 2 for each → 4 tiles fill 2 rows):**

1. **Integrations** (cols 1–3):
   - Header: `INTEGRATIONS · 3 / 3` + `Manage ↗`
   - 3 integration rows (Jira / GitLab / GitHub) — 26×26 accent-dim glyph, 13px name, 10.5px mono handle, green `● OK` status
   - `Events / 24h: 148 evt` + `Webhook p95: 212 ms` metric pair (2-col)
   - `Recent sync` log: 4 dashed rows — `JR · pull → 204 · 2m`, etc.

2. **Merged** (cols 4–7, **accent tile** — full indigo fill, white text):
   - `MERGED · THIS WEEK` label + `vs. previous`
   - `11` at 96px, next to `+3 vs. previous` / `Prior: 8`
   - `dither-merged.svg` top-right (220×220, opacity .35)
   - Spark area chart at bottom, white stroke, 8-point

3. **Review rounds** (cols 8–9):
   - `1.8 avg` at 56px
   - Stat note: `Lower is tighter · team p50: 2.1`
   - Two bar rows — `You 1.8` (58% fill, accent), `Team 2.1` (72% fill, dim-fg)
   - `8-week trend` wk-spark — 8 bars, last one active/accent

4. **Linkage** (cols 10–12):
   - `92 %` at 56px + green `+4pt · vs last wk`
   - Two bar rows — `This wk 92%` (accent fill), `Target 80%` (accent-2 fill)
   - 2-col micro-stat grid — `Linked MRs: 47`, `Orphans: 4`

### SECTION 02 — At a glance & on your plate

**Layout:** `flex-direction: column`, `gap: 18px`

1. **Attention band** (full-width card, `border-left: 3px solid var(--accent)`):
   - Header: `NEEDS YOUR ATTENTION · 3` + `Quiet nudges, not alarms.` + `DISMISS ALL` right-aligned
   - 3-col grid (`repeat(3, 1fr)`, gap 14px) of `.a-card`s — see copy below
2. **Grid** (12-col):
   - **Tickets kanban** (cols 1–7): 3-column kanban — `In flight · 5`, `Queued · 6` (6 items, show 4), `Shipped · 3`
   - **Open PRs + Linked commits** (cols 8–12): 7 PR rows, divider, then 4 mini-commit rows

**Attention card copy (exact):**
| Ref | Kind | Title | Detail | Action |
|---|---|---|---|---|
| `!27` | Stale PR · high | feat(snapshots): persist per-week trend buckets in localStorage | open · 6 days · 2 reviewers idle | Nudge reviewers ↗ |
| `ESP-411` | Old ticket · med | Investigate flaky CI on main (timeout on Redis bootstrap) | in flight · updated 9d ago | Reply with status ↗ |
| `!31` | Stale PR · low | chore(deps): bump next → 16.0.3, swr → 2.3 | open · 3 days · needs rebase | Rebase & ping ↗ |

**Ticket cards (`.ticket`):**
- 1px border, `card-alt` background, `radius-sub`
- Top row: `ticket-key` (accent mono bold) + `ticket-due` (dim mono)
- Summary: 12px, line-height 1.35, `text-wrap: pretty`
- Hover: border becomes `border-strong`

**PR rows (`.pr`):**
- 3-col grid: `[src badge] [title] [age]`
- `.pr-src` is a 1px-bordered mono tag like `GL !27` or `GH #84`
- Title truncates with ellipsis

**Mini-commits:** smaller variant (`.mini-commit`) with 60px sha column, dashed bottom border.

### SECTION 03 — Goals & evidence

**Layout:**

1. **Goals tile** (single 12-col tile): 4-column goal grid, one column per L1 objective
2. **Evidence grid** (12-col, 3 equal tiles):
   - Snapshots (cols 1–4)
   - Export panel — accent tile (cols 5–8)
   - Recent commits (cols 9–12)

**Goal column (`.goal-col`):**
```
┌────────────────────────────────────┐
│ [L1 · 01 pill] [30% pill]     3/4 │
│ Goal title (2-line clamp)          │
│ ▓▓▓▓▓▓▓░░░  (4px progress bar)    │
│ ┌ L2 row ───────── [status pill] ┐│
│ │ Ship bento dashboard to prod   ││
│ └────────────────────────────────┘│
│ … more L2 rows …                   │
└────────────────────────────────────┘
```

Status pill variants: `pill ok` (green), `pill accent` (indigo), `pill warn` (red), `pill` (neutral, `—` for not-started).

**Export panel** (accent tile, indigo fill):
- Header: `EVIDENCE · BUNDLE` + `OPEN ↗` (white on accent)
- `export-title`: 22px white display text — `Bundle your receipts for 1:1s & promo.`
- Three `.exp-section`s: **Range** (chip row, `90D` active), **Format** (chip row, `.md`+`.pdf` active), **Sections** (2-col checkbox grid, 6 options, first 4 checked)
- `.exp-chip`: 1px white-30% border, mono 10px, radius 999px. `.on` state = solid white fill, accent text.
- Checkbox: custom-styled 12×12 — checked = white fill with accent checkmark (rotated border pseudo-element)
- `.btn-export` at bottom: white fill, accent text, mono 11px uppercase, translateY(-1px) on hover with shadow
- `dither-export.svg` bottom-right corner (180px tall, opacity .35)

**Recent commits tile:**
- 12 commit rows, inner-scrollable (`.commits-scroll` with `overflow-y: auto`)
- Each row: `[7-char sha accent] [message ellipsis] [age mono]`

### SECTION 04 — Trends

12-col grid, one row (`grid-auto-rows: 1fr`):

1. **Activity chart** (cols 1–6): SVG area chart, indigo stroke 2.25, accent-dim gradient fill (0.4 → 0 alpha). X-axis: Mon–Sun mono labels.
2. **Turnaround histogram** (cols 7–9): 5 accent bars with numeric labels above (`4`, `9`, `7`, `5`, `3`) and bucket labels below (`<2h`, `<6h`, `<1d`, `<2d`, `2d+`). Stat note below: `Median 9.2h · 30d window`.
3. **Reviews given** (cols 10–12): list of 6 `.rev-row`s — `sana.elmi 14`, `karim.haddad 11`, `youssef.b 7`, `amira.z 5`, `noor.saleh 4`, `+ 6 others 12`. Count is accent-colored mono bold.

---

## Interactions & Behavior

| Interaction | Behavior |
|---|---|
| Scroll | `scroll-snap-type: y mandatory` on scroll root; `scroll-snap-stop: always` per section — each snap is deliberate, can't skip |
| Click rail bubble | `sections[i].scrollIntoView({behavior:'smooth', block:'start'})` |
| Section change | `IntersectionObserver` picks highest intersection ratio → toggles `.active`, updates counter |
| Hover rail bubble | Bubble grows 6→9px, tooltip fades in from right (150ms) |
| Hover tile/card | Border darkens (`border` → `border-strong`), 150ms transition |
| Hover toolbar button | Pointer cursor |
| Hover Export button | translateY(-1px) + drop shadow |
| Click Export | Text swaps to `Exporting…` (stub in mock; wire to real export action) |
| Chip/checkbox toggles | Currently static in mock — implement as controlled state |

### Accessibility notes
- Every rail button has implicit label from `rail-tip` text — add `aria-label="#overview"` etc. for screen readers.
- Rail is wrapped in `<nav aria-label="Dashboard sections">`.
- Sections should have `aria-labelledby` pointing at their `.sec-title` `<h2>`.
- Tooltip is decorative; the `rail-tip` text should be visible or duplicated in `aria-label`.

---

## State Management

State to extract when wiring to real data:

```ts
type DashboardState = {
  range: '7D' | 'ThisWeek' | '30D' | '90D' | 'Qtr';   // toolbar + export
  activeSection: 'overview' | 'glance' | 'goals' | 'trend';  // driven by IO
  attention: AttentionItem[];       // 3-card band
  integrations: Integration[];      // 3 rows + metrics + sync log
  metrics: {
    mergedThisWeek: number; mergedPrior: number; mergedSpark: number[];
    roundsAvg: number; roundsTeamP50: number; roundsWeekly: number[];
    linkagePct: number; linkageTarget: number; linkedMRs: number; orphans: number;
  };
  tickets: { inFlight: Ticket[]; queued: Ticket[]; shipped: Ticket[] };
  prs: PullRequest[];
  linkedCommits: Commit[];          // mini, inside PR tile
  goals: L1Goal[];                  // each has L2Goal[]
  snapshots: Snapshot[];
  exportConfig: { range: string; formats: Set<string>; sections: Set<string> };
  recentCommits: Commit[];
  activity: { series: number[]; peak: number; total: number };
  turnaround: { buckets: { label: string; count: number }[]; medianHrs: number };
  reviewsGiven: { user: string; count: number }[];
};
```

Drive everything from the existing integrations layer (`src/app/integrations/*` in the codebase). The `range` toolbar + export-range chips should share state; changing one updates both.

---

## Assets

All assets used in the prototype are included in this handoff folder:

| File | Role | Where |
|---|---|---|
| `dither-signal.svg` | Dot-matrix fill for Signal tile | Section 01, right half of Signal card, left-to-right gradient mask |
| `dither-merged.svg` | Dot-matrix fill for Merged tile | Section 01, top-right corner of accent Merged tile |
| `dither-export.svg` | Dot-matrix fill for Export tile | Section 03, bottom-right corner of accent Export tile |

These were generated from the real `DitherField` React component in the codebase — re-use that component in production rather than the static SVGs where possible. In the mock they are fetched and injected as inline SVG so the `currentColor` trick works.

**No icon font / no emoji** is used. If you need iconography (e.g., for `↗` and `↓`), the mock uses the literal Unicode glyphs as text.

---

## Files in this Handoff

| File | Purpose |
|---|---|
| `README.md` | This document |
| `Dashboard Scroll Sections.html` | The single-file prototype. All CSS + HTML + JS inline. Open it in a browser to see the live design. |
| `dither-*.svg` | The three dither fill assets referenced by the prototype |

The prototype's CSS is organized top-to-bottom in this order: tokens → header → scroll container → section headers → grid → tiles → pills → hero → attention → toolbar → integrations → stats → goals → tickets → PRs → chart → turnaround → reviews → snapshots → export → commits → integrations extras → evidence-export panel → rail → counter. Read it as a stylesheet table of contents.

---

## Implementation Notes

1. **Start from the tokens.** Everything else cascades from `--bg`, `--fg`, `--accent`, the two fonts, and the 4 px / 3 px / 999 px radius system. If the codebase already has a HexaCore token file (`src/app/globals.css`), reconcile — do not duplicate.
2. **Build the scroll-snap shell first.** Get the four empty sections snapping and the rail + counter working before filling tiles. That shell is the hardest interaction to re-create.
3. **Tiles are self-contained.** Each tile is a leaf component; they share `.tile` / `.tile.accent` / `.tile-label` / `.tile-title` building blocks. Keep them composable.
4. **The accent tile is different.** It has `color: var(--accent-on)`; all descendants re-color `.mono`, `.bigsub`, dither opacity, etc. The Export panel's chip and checkbox styles only make sense on this accent background.
5. **Do not add shadows or gradients.** The design's restraint is a feature. Only the two places listed in Design Tokens use shadow.
6. **Copy strings are intentional.** `Waiting on you or yours`, `Quiet nudges, not alarms.`, `Bundle your receipts for 1:1s & promo.`, `Lower is tighter`, `Where you showed up` — these set the product's voice. Preserve them verbatim unless you're changing the product voice itself.

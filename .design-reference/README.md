# Handoff — eSpace Dev Hub

A personal performance dashboard + evidence tracker for eSpace engineers. Pulls live data from **Jira**, **self-hosted GitLab**, and **GitHub** into one bento-grid view so a developer can (a) watch their own delivery & code-quality metrics in real time, and (b) generate shareable evidence when L0 / L1 / L2 review season arrives.

---

## About the design files

The files in `design-reference/` are **design references built in HTML** — a hi-fi interactive prototype showing the intended look, feel, and behavior of every screen. They are **not production code to copy directly**.

The task is to **recreate these designs in the target codebase** (Next.js 16 + App Router + Tailwind v4 + Radix, per the PRD) using the codebase's established patterns. Use the HTML as the pixel-accurate source of truth for layout, spacing, typography, and color. Replace inline styles with Tailwind, replace the vanilla-React state hooks with SWR for remote data, and swap the design-reference dummy data for real API calls to `/api/jira/*`, `/api/gitlab/*`, `/api/github/*`.

## Fidelity

**High-fidelity.** Final colors, typography, spacing, micro-interactions, and copy are all set. Match pixel placement; match the copy verbatim; match the hover / active states.

---

## Stack (per PRD — confirm before building)

- **Next.js 16** (App Router, JSX)
- **Tailwind v4** (CSS variables-first)
- **Radix** primitives for menus/dialogs (the prototype doesn't use them yet; wrap tab components, the settings nav, and the onboarding step indicator in Radix)
- **Framer Motion** for the attention band dismissal + snapshot chart point transitions
- **Recharts** for the snapshot trend chart (prototype uses hand-rolled SVG — swap)
- **SWR** for data fetching — one hook per provider resource (`useJiraTickets`, `useGitlabOpenMrs`, `useGitlabReviewRequests`, etc.)
- **sonner** toasts for "Snapshot captured", "Token rotated", etc.

### Auth model (v0 — no backend DB, per PRD)

Tokens live in browser `localStorage`. Next.js API routes act as CORS-dodging proxies. Server is stateless.

| Provider | How it connects | Where the token lives |
|---|---|---|
| Jira | User pastes email + Atlassian API token | localStorage |
| GitLab (self-hosted) | User pastes PAT (scope: `read_api`) | localStorage |
| GitHub | OAuth 2.0 redirect | localStorage |

**Endpoints to scaffold:**
- `GET/POST /api/jira/[...path]` — forwards Basic-auth to `<JIRA_URL>/rest/api/3/...`
- `GET /api/gitlab/[...path]` — forwards Bearer to `<GITLAB_URL>/api/v4/...`
- `GET /api/github/[...path]` — forwards Bearer to `api.github.com/...`
- `POST /api/oauth/github/exchange` — token exchange (needs server-side `GITHUB_CLIENT_SECRET`)

---

## Design tokens

### Colors

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--bg` | `#f1eee6` | `#0a0a0f` | Page background — warm off-white / near-black |
| `--fg` | `#0b0b14` | `#f1eee6` | Primary text |
| `--card` | `#ffffff` | `#14141d` | Tile / panel background |
| `--card-alt` | `#faf8f2` | `#1a1a25` | Nested tile background (ticket rows, picker cards) |
| `--border` | `rgba(10,11,22,0.10)` | `rgba(255,255,255,0.08)` | Hairline borders |
| `--muted-fg` | `rgba(11,11,20,0.55)` | `rgba(241,238,230,0.55)` | Secondary text |
| `--dim-fg` | `rgba(11,11,20,0.38)` | `rgba(241,238,230,0.35)` | Timestamps, axis labels |
| `--accent` | `#3826ff` | same | **Electric blue — primary accent, hero, CTAs** |
| `--accent-on` | `#ffffff` | same | Text on accent |
| `--accent-dim` | `{accent}1a` (10% alpha) | same | Hover / active fill |
| `--accent-2` | `#00c48a` | same | Live-indicator green (only place secondary is used) |
| `--good` | `#047857` | same | Positive deltas |
| `--bad` | `#b91c1c` | same | Negative deltas |

**Palette discipline:** the PRD says deep royal blue + warm off-white, strictly. The prototype uses `#3826ff` (Electric) as the default — closer to the "HexaCore" direction the user approved. Confirm with the team before shipping; `#1D4ED8` is the PRD-spec'd cobalt alternative and is available as a Tweak swatch in the prototype.

### Typography

- **Display / sans:** `Inter Tight` (400 / 500 / 600 / 700) — headlines, stat numerals, UI text
- **Mono:** `JetBrains Mono` (400 / 500 / 600 / 700) — labels, tags, timestamps, refs, keys
- **Serif italic accent:** `ui-serif, "Iowan Old Style", Georgia, serif` — **italic only**, used for one accent word per big headline (`Measure. Merge. Make the *case*.`) and for snapshot week notes

### Type scale

| Role | Family | Size | Weight | Letter-spacing | Line-height |
|---|---|---|---|---|---|
| Hero headline | display | `clamp(48px, 6.5vw, 92px)` | 600 | `-2.5px` | 0.94 |
| Page header | display | `clamp(40px, 5vw, 68px)` | 600 | `-1.8px` | 0.98 |
| Section H2 | display | 22px | 600 | `-0.5px` | 1.2 |
| Tile title | display | 14–18px | 600 | `-0.1px` | 1.3 |
| Giant stat | display | 56–96px | 600 | `-1.8` to `-4px` | 0.9–1 |
| Body | sans | 13–15px | 400–500 | 0 | 1.5 |
| Mono label | mono | 10.5px | 400 | `+0.6px`, uppercase | 1 |
| Mono inline | mono | 10–12px | 500–700 | `+0.3–0.5px` | 1 |
| Ref (`!8821`, `PAY-4812`) | mono | 10–11px | 700 | 0 | 1 |

### Spacing

- Page gutter: `40px` left/right
- Section vertical gap: `28–36px`
- Tile padding: `14px` (dense) / `18px` (balanced) / `22px` (airy) — default balanced
- Bento grid gap: `10 / 14 / 18px` matching density
- Tile row height: `132 / 150 / 168px` matching density

### Radii

- Tiles & cards: `4px` (deliberate — not rounded-24px as the PRD suggested; the HexaCore direction the user picked is crisper)
- Sub-elements (picker cards, ticket rows): `3px`
- Pills / avatar chips: `999px`

### Shadows

Almost none. Borders carry the weight. The only shadow is the Tweaks panel (`0 20px 60px rgba(0,0,0,0.25)`).

### Signature texture

**Dithered / halftone dot fields** appear on the hero signal tile, the merged-this-week tile, the linkage disc, and the activity chart. Implemented in `primitives.jsx` (`DitherField`, `DitherDisc`, `DitherBars`). These are the brand's *vibe* — recreate them or replace with equivalent decorative SVGs; do not drop them without consultation. There's also a low-opacity static-noise PNG grain overlay (`Grain` component) applied page-wide.

---

## Global chrome

### Header (`V1.Header` in `v1.jsx`)

- Sticky top, 14px × 40px padding, 1px bottom border, backdrop-blur(12px) with translucent `--bg`
- Left: hexagonal dot logo (see `V1.LogoMark` — circles arranged in 3 concentric hex rings) + `eSpace<span accent>/</span>DevHub` + a small `v0.3.1` mono chip
- Nav tabs: `Dashboard · Evidence · Snapshots · Settings` — mono, uppercase, 12px; active tab has `--accent-dim` background + `--fg` color; hover not yet speccd (use `--accent-dim` at 50%)
- Right: live dot (green if connected, dim if not) + `LIVE · 3 integrations` mono text, then avatar chip (circle with initials + name)

### Logo mark

3 concentric hex rings of dots + 1 centered dot, all in `--accent`. Pure SVG, 26×26. Keep.

### Footer

Hairline border top, 16px vertical padding, mono 10.5px, muted. `eSpace/DevHub · {team} · refreshed 32s ago` left; `↗ github.com/espace/devhub` right.

---

## Routing

Hash-based in the prototype (`#/evidence`, `#/snapshots`, `#/settings`, `#/onboarding`). In Next.js App Router:

```
app/
├── layout.tsx             ← header + footer + grain overlay
├── page.tsx               ← Dashboard
├── evidence/page.tsx
├── snapshots/page.tsx
├── settings/page.tsx
│   └── [tab]/page.tsx     ← integrations | account | snapshots | danger
└── onboarding/page.tsx
```

Active-state detection: `usePathname()` from `next/navigation`.

---

## Screens

### 1. Dashboard (`/`)

**Purpose:** ambient scoreboard — what's on my plate now, how am I trending, quick jump to evidence.

**Layout (top to bottom):**
1. **Hero** — left: editorial headline `Measure. Merge. Make the case.` (italic serif "case" in accent color), subtitle, mono overline `W16 · Apr 20 — Apr 26 · L1 → L2 track`. Right: 280×180 dithered "signal" tile showing 147 events tracked over 14d.
2. **Attention band** (new — not in PRD). Hairline-bordered card with left accent border. Mono label `Needs your attention · {n}` + subtitle "Quiet nudges, not alarms." Inline 3-column grid of attention cards (stale PR, old ticket, etc.) with severity tag + action CTA.
3. **Bento grid** — 12-column, 150px row-height grid with gap 14. Tile list below, with grid positions.

**Bento tiles (all defined in `v1.jsx`):**

| Tile | Span | Content |
|---|---|---|
| `IntegrationsTile` | col 3 × row 2 | 3 providers, each with glyph, user handle, OK status dot. "MANAGE ↗" top-right. |
| `MergedTile` (accent, hero) | col 4 × row 2 | Solid `--accent` background, white text. Giant `8` numeral (96px, -4 tracking). +3 vs W15, 8w avg 5.3. White sparkline at bottom. Dithered dot field in top-right corner at 35% opacity. |
| `RoundsTile` | col 2 × row 2 | Big `1.6` stat, green `↓ 0.4` delta (invert=true, lower is better). 10 mini-bars below. |
| `LinkageTile` | col 3 × row 2 | Big `94%` + delta + stat breakdown (94 linked, 6 loose). 80×80 dithered disc on right with 24/7 circular badge. |
| `TicketsTile` | col 7 × row 3 | Title "Tickets on your plate". 3 columns: In flight / Queued / Shipped. Each column is a list of ticket cards (`PAY-4812` mono ref, title, due date). |
| `PRsTile` | col 5 × row 3 | Title "Open PRs". Two blocks stacked: "Yours" + "Awaiting your review". Each row: mono number (`!8821`), title (ellipsis), repo + age/rounds, pipeline pill. |
| `ActivityTile` | col 6 × row 2 | Title "Signal strength". 14-day bar chart, dithered by default. X-axis labels every other day. |
| `TurnaroundTile` | col 3 × row 2 | Big `14h` stat + `-6h` green delta. Histogram bars `<2h / 2–8h / 8–24h / 1–2d / 2–4d / >4d`. |
| `ReviewsTile` | col 3 × row 2 | Big `47` stat + `+12` delta. Sparkline below. |
| `SnapshotsTile` | col 5 × row 2 | Title "Keep receipts for review season." Table of 4 recent snapshots: date, note (ellipsis), mono summary `8 merged · 47 reviews · 94%`. "SEE ALL ↗" → `/snapshots`. |
| `ExportTile` (accent) | col 4 × row 2 | Solid accent. "Bundle last 90d as markdown + PDF." + mono sublist of what's included. "OPEN ↗" → `/evidence`. Dithered texture in bottom-right. |
| `CommitsTile` | col 3 × row 2 | List of recent commits: mono sha, message (ellipsis), repo + relative time. |

**Density:** expose a tweak that toggles between airy / balanced / dense. Maps to `{pad, gap, rowH}` triplet above.

**Visible-tiles toggle:** the prototype lets you hide any tile individually — useful for the "customize dashboard" future state. Keep the plumbing in place; defer the UI.

### 2. Evidence (`/evidence`) — **the moneyshot**

**Purpose:** turn 90 days of scattered receipts into one reviewable doc.

**Layout:** `340px | 1fr` two-column grid, 20px gap. Left column is sticky (`position: sticky; top: 80px`).

**Page header:**
- Crumb: `Evidence · 90-day performance bundle`
- Title: `Make the case.` with italic serif accent on "case"
- Subtitle: "Turn 90 days of scattered receipts into one reviewable document. You pick what to include; the data speaks for itself."
- Right: `← Dashboard` ghost button + primary `Export .md` / `Export .pdf` (label reflects selected format)

**Left — configuration cards (stacked, 20px gap):**
1. **Format** — 2-col segmented: Markdown (`.md · paste-ready`) / PDF (`.pdf · print-ready`)
2. **Date range** — 2×2 grid: Last 30d / Last 90d / Q1 2026 / Custom… + mono subline showing resolved range
3. **Performance cycle** — free-text input, placeholder `L1 → L2`, hint "Appears as the header of the exported document."
4. **Sections** — 5 checkboxes: Narrative intro / Headline metrics / Merged PRs (starred) / Closed tickets (starred) / Notable reviews given
5. **Privacy note** — mono text, no card: "PRIVACY · FIRST — This bundle is generated in your browser. Nothing is uploaded. You paste the output wherever you want it to go."

**Right — two stacked cards:**

1. **Document preview** — styled like paper, 40×48px padding. Header strip with live-preview indicator + line/item count. Document body has:
   - Mono filename (`# performance-review-90d.md`)
   - Big serif italic name (`Mariam Hany — L1 → L2`, 34px, `Iowan Old Style`)
   - Mono team + range line
   - Numbered sections `01 / Summary`, `02 / Headline metrics`, `03 / Merged pull requests · N` etc.
   - Summary section has an inline editable `<textarea>` (dashed border, serif italic font). Hint below: "Click to edit · your words, not ours"
   - Metrics section: 4×2 grid of metric boxes (mono uppercase label, 26px numeral, 10px sub with good/muted color)
   - PRs/tickets/reviews sections: rows with mono ref + title + date, then indented `→ impact` line
   - Footer: "Generated by eSpace/DevHub · {today}" left, "Source: Jira + GitLab + GitHub" right

2. **Evidence picker** — card with header "Star as evidence · {n} selected" + subtitle "Curate what lands in the export. Only starred items appear in the document above." Right: ghost "Auto-pick top 10" button. Body: 2-col grid of evidence candidates. Each card shows mono ref, kind label (PR / Ticket / Review), **star glyph**, title, `→ impact` line if present, and date. Starred state: accent border + `--accent-dim` fill + filled star.

**State:**
- `format: "markdown" | "pdf"`
- `range: "30d" | "90d" | "q1" | "custom"`
- `includeNarrative / includeMetrics / includePRs / includeTickets / includeReviews: boolean`
- `level: string`
- `narrative: string`
- `starred: string[]` — list of evidence IDs

**Export behavior:** client-side template rendering. For Markdown, string-concatenate into a `.md` blob and trigger download. For PDF, render the same document DOM inside a print-optimized route (`/evidence/export/print`) and call `window.print()` — the user saves as PDF via browser print dialog.

### 3. Snapshots (`/snapshots`)

**Purpose:** 8+ week trend of your own metrics, you vs. you.

**Layout (stacked, full width):**

1. **Page header** — crumb `Snapshots · 8 weeks · W09 — W16 2026`, title `Your trend, on record.` (italic "trend"), subtitle "Every Monday morning we freeze the dashboard into a snapshot. The line you're watching is you, vs. you." Right: `← Dashboard` ghost + primary `Snapshot now`.

2. **Metric switcher** — row of 5 pill buttons (mono, 11px): `Merged PRs / Reviews given / Turnaround (hours) / Jira linkage / Rounds per MR`. Active has accent fill + white text.

3. **Trend chart card** (big, ~260px tall inside an 80px header strip):
   - Header strip: left column shows mono `{metric} · 8 weeks` + 44px numeral of latest value with delta vs. first point (green/red respecting invert for turnaround & rounds). Right column shows 8-week average.
   - Chart body: 24px padding. SVG line + filled area (accent at 12% opacity). 5 horizontal gridlines at 0 / 0.25 / 0.5 / 0.75 / 1. Dots per point, with an outline ring on the selected week. Bottom: week labels (W09–W16), clickable, active one in accent + bold.
   - Clicking a week updates the selected week for the next section.

4. **Selected week detail** — section labeled `01 / Selected week · W16 (Apr 22, 2026)`. 5-col stat grid (label + 44px display number + mono sub). Below: dashed-border quote card with serif italic week note.

5. **All snapshots table** — section `02 / All snapshots`, right label `{n} weeks`. 8-col table (Week / Date / Merged / Reviews / Turn. / Link. / Rounds / Note). Header row has `--card-alt` background + mono uppercase labels. Rows: 12px padding, dashed-underline between. Clicking a row selects it (highlighted in accent-dim).

**State:** `metric`, `selected` (week string)

**Data:** one snapshot per week. In prod, generate these via a scheduled server action (cron) that calls the same SWR endpoints and persists to IndexedDB / localStorage. Retention default: 26 weeks (6 months).

### 4. Settings (`/settings`)

**Purpose:** manage integrations, account, snapshot prefs, destructive actions. Privacy-first copywriting is the product.

**Layout:** `220px | 1fr` two-column, 32px gap. Left is a sticky vertical nav; right is the active tab panel.

**Page header:** crumb `Settings · your tokens, your data`, title `Your keys. Your terms.` (italic "terms"), subtitle "Everything lives in your browser. We never see your tokens, and your metrics never leave this tab unless you export them."

**Nav (left column, 4 items):**
- Integrations
- Account
- Snapshots & privacy
- Danger zone

Each: 10×14px padding, mono uppercase 11px, no border. Active: `--accent-dim` background, 2px left-border accent, accent text.

**Tab: Integrations**

- Section `01 / Connected providers` — 3 provider cards stacked. Each card: 48×48 square glyph (accent-dim bg, mono `J` / `GL` / `GH`) + info column (name + ●Connected pill + mono user+since+last-sync + body text explaining endpoint/scopes) + right buttons (`Rotate token` ghost, `Disconnect` danger, both sm).
- Section `02 / How tokens are stored` — one Card with a 2-col grid of 4 privacy points (5px accent dot + mono uppercase title + body paragraph). Exact copy:
  1. **localStorage only** — "Your Jira email, GitLab PAT, and GitHub OAuth token live in your browser's localStorage — scoped to this origin. They never touch our server."
  2. **We proxy, not persist** — "When you load the dashboard, the browser sends each token to our API route, which forwards it to Jira / GitLab / GitHub to dodge CORS. We don't log the token and we don't cache the response."
  3. **Minimum scopes** — "GitLab PAT: `read_api`. GitHub OAuth: `repo` + `read:user`. Jira: user-scoped API token. We never request write scopes."
  4. **Rotate any time** — "Revoke a token in its source (Jira profile, GitLab preferences, GitHub settings) and the connection goes dark within 60s. No cleanup required on our side."

**Tab: Account**
- One section, one card, 2-col form grid: Display name / Handle / Team / Current level, each with label + input + optional hint.

**Tab: Snapshots & privacy**
- Section 01: `Snapshot schedule` — Card with 2 fields (Frequency, Retention) + callout explaining browser-storage caveat.
- Section 02: `What we explicitly do not do` — Card with 4 stacked items (display-serif title + body), dashed underline between:
  - No leaderboard. / No manager view. / No telemetry. / No third-party cookies.

**Tab: Danger zone**
- 4 rows (2-col: description + action button):
  - Export snapshots as JSON (ghost button)
  - Clear snapshot history (danger)
  - Disconnect all providers (danger)
  - Reset everything (danger)

Each row: display-serif 14px title + 12.5px muted body, dashed underline between.

### 5. Onboarding (`/onboarding`)

**Purpose:** first impression when 0 integrations connected. Sell the product, then walk through Jira → GitLab → GitHub.

**Layout:** 1200px max-width, centered, 64px top padding. `1fr | 440px` grid, 48px gap.

**Left — the pitch:**
- Mono overline: `Welcome · 0 of 3 connected`
- Big headline: `Receipts for review season. Calm for the rest of it.` (italic serif "review" in accent)
- Subtitle paragraph
- 2×2 grid of value props (5px accent dot + mono uppercase title + 12.5px body), copy in prototype file.
- Below: **blurred dashboard preview** — a 220px-tall card with a blurred skeleton bento grid inside (accent hero tile in position 2, others are card-alt) with a gradient fade to bg at the bottom and mono label `your dashboard, once connected ↓`.

**Right — connect wizard (sticky, 440px):**
- Header: mono label `Connect · step {n} of 3` + 3-dot progress indicator (18×3px bars, active → accent)
- Title: `Connect Jira / GitLab / GitHub` (display, 22px)
- Description paragraph per step (exact copy in `screen-onboarding.jsx`)
- Form fields per step:
  - **Jira:** workspace URL (mono), email, API token (mono, type=password)
  - **GitLab:** GitLab URL (mono), PAT (mono, type=password) — hint "read_api scope is enough. Don't grant write."
  - **GitHub:** no form — dashed-bordered callout explaining the OAuth redirect to `github.com/login/oauth/authorize`
- Footer: `← Back` ghost (disabled on step 0), `Continue →` primary (or `Authorize & finish` on step 2)
- Below divider: left mono "Only connect what you use." + right "Skip for now →" link (ghosts to dashboard)

---

## Shared primitives

Lifted from `primitives.jsx` and `screens-shared.jsx`. Re-implement as Tailwind components.

- **`<MonoLabel>`** — 10.5px mono, uppercase, `+0.6px` tracking, `--muted-fg`
- **`<Pill>`** — 999px radius, 10.5px, variants: `default | accent | solid | warn | ok | muted`; `mono` prop swaps font
- **`<Delta>`** — `↑ / ↓ / ·` prefix + value, colored by sign (with `invert` for "lower is better")
- **`<Sparkline>`** — simple SVG line chart, optional fill + dots
- **`<Bars>`** — bar chart, simple
- **`<DitherField>`, `<DitherDisc>`, `<DitherBars>`** — deterministic-noise dot fields (see implementation in file). **Keep these** — they're the brand's signature.
- **`<Grain>`** — procedurally generated noise PNG (via canvas) used as page background overlay. ~180×180 tile.
- **`<Screens.Page>`, `<Screens.PageHeader>`, `<Screens.Section>`, `<Screens.Card>`, `<Screens.Btn>`, `<Screens.Field>`, `<Screens.Input>`, `<Screens.Stat>`** — page scaffolding used by Evidence/Snapshots/Settings/Onboarding.

### Button variants

- `primary` — accent bg, white fg, accent border
- `ghost` — transparent bg, fg text, border
- `solid` — fg bg, bg text (inverted — used for "Reset filters" kind of moments)
- `danger` — transparent bg, `--bad` text, `--bad` border

All buttons use mono font, 700 weight, uppercase, `+0.4px` tracking. Sizes: `sm` (6×12, 11px) / `md` (10×18, 13px) / `lg` (14×24, 14px).

---

## Data contracts

See `data.jsx` for canonical shapes (ME, INTEGRATIONS, TICKETS, OPEN_MRS_MINE, OPEN_MRS_REVIEW, ACTIVITY_14D, MERGED_TREND, TURNAROUND_BUCKETS, METRICS, SNAPSHOTS, RECENT_COMMITS, ATTENTION, EVIDENCE_STARRED, EVIDENCE_CANDIDATES). Replace with typed SWR responses.

**Derivation notes:**
- `METRICS.mergedThisWeek` = count of GitLab MRs where `state=merged` and `merged_at` within current ISO week, authored by user
- `METRICS.turnaround` = median of `(merged_at - created_at)` across merged MRs in range, excluding drafts
- `METRICS.avgRounds` = mean of review comment counts on user's merged MRs in range (exclude the user's own comments)
- `METRICS.reviewsGiven` = count of comments user left on teammates' MRs in range
- `METRICS.linkage` = % of user's merged MRs whose title or description contains a Jira key (regex `/[A-Z]+-\d+/`)
- `ATTENTION` = derived client-side: stale-PR = user's open MRs with `updated_at > 3 days ago`; old-ticket = In-Progress Jira tickets with no changelog entry in > 7 days

---

## Interactions

- **Hover on bento tiles:** prototype has none. Add a subtle `--card-alt` bg shift on hover for the ones that link somewhere (Snapshots tile, Export tile, ticket cards, PR rows). Use Tailwind `hover:bg-card-alt transition-colors`.
- **Active week in snapshot chart:** animate the ring radius with Framer Motion `layout` / `scale` spring on select.
- **Evidence star toggle:** the star glyph should pop (scale 1 → 1.3 → 1 spring) on toggle.
- **Attention band dismiss:** "DISMISS ALL" collapses the band with a 200ms height animation; per-item dismiss not yet designed.
- **Tab switching in Settings:** no animation in prototype; keep it snappy (no fade) — the left-border accent flip is enough signal.
- **Onboarding "Test & continue":** shows a 400ms loading state on the button, then advances. If token invalid, show sonner error toast.

---

## Responsive

The prototype is desktop-only (1440px design width). For v0 that's fine — confirmed with the user. Mobile/tablet is out of scope this pass; add a "Dev Hub is desktop-only for now" breakpoint note below 1024px and stub the page.

---

## Files in this bundle

```
design_handoff_espace_dev_hub/
├── README.md                     ← you are here
└── design-reference/
    ├── eSpace Dev Hub.html       ← entry point; open in browser to see everything
    ├── v1.jsx                    ← Dashboard shell + Attention band + all bento tiles + header/footer
    ├── data.jsx                  ← all dummy data (ME, METRICS, TICKETS, SNAPSHOTS, EVIDENCE_*, ATTENTION)
    ├── primitives.jsx            ← DitherField, DitherDisc, Grain, Sparkline, Bars, Pill, Delta, MonoLabel
    ├── screens-shared.jsx        ← Page, PageHeader, Section, Card, Btn, Field, Input, Stat
    ├── screen-evidence.jsx       ← Evidence export (editable narrative + star picker)
    ├── screen-snapshots.jsx      ← Trend chart + table
    ├── screen-settings.jsx       ← 4 settings tabs
    └── screen-onboarding.jsx     ← Empty-state + 3-step wizard
```

Open `eSpace Dev Hub.html` in any modern browser — no build step. Use hash URLs to jump between screens: `#/evidence`, `#/snapshots`, `#/settings`, `#/onboarding`.

---

## Open questions / decisions for the developer

1. **Accent color:** PRD says `#1D4ED8` cobalt; prototype defaults to `#3826ff` electric. Confirm with design.
2. **Radii:** PRD says 24px; prototype uses 4px. Prototype aesthetic (HexaCore) was approved — keep 4px unless revisited.
3. **Dithered textures:** worth the implementation cost? If yes, port `DitherField` as-is (deterministic SVG, no perf concern). If team wants simpler, replace with solid accent fills.
4. **PDF export:** browser `window.print()` is the v0 path. If a proper PDF is needed, add `@react-pdf/renderer` later.
5. **Snapshot cron:** needs a decision — Next.js scheduled action (Vercel Cron) vs. client-side on-open-Monday detection. Client-side is simpler for v0 since everything is localStorage anyway.

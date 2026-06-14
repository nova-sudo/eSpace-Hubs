# eSpace Dev Hub — engineering guide

> Personal performance dashboard + evidence tracker for eSpace engineers.
> Pulls live data from Jira, self-hosted GitLab and GitHub into one bento grid.
> This file is the canonical reference for _where things go_ and _why_.

## Stack

- **Next.js 16** App Router, JSX (no TS).
- **Tailwind v4** CSS-variables-first. Tokens in `src/app/globals.css`.
- **next/font** for Inter Tight (display / sans) + JetBrains Mono (mono / labels).
- **SWR** for all remote data. No React Query.
- **Recharts** for the snapshot trend chart only; other charts are hand-rolled SVG
  (sparkline, dither fields, bars) to keep the HexaCore aesthetic crisp.
- **Framer Motion** reserved for interaction polish — not required for correctness.
- **sonner** for toasts.

## Monorepo

Three deployable units share this repo:

| Package | Purpose |
|---|---|
| `apps/web` | Next.js 16 frontend — the dashboard, evidence, settings, and all user-facing pages. |
| `apps/api` | Node/Express REST API — auth, AI classification, grading, snapshots, hub management. |
| `packages/api-contracts` | Shared request/response type shapes — keeps the web ↔ api contract explicit. |
| `packages/shared` | Pure utilities shared across both apps (no framework deps). |

`apps/web` is the primary working surface for UI work. `apps/api` owns server-side logic.
Cross-package imports flow **web → api-contracts ← api** and nothing else (web never imports api).

## Architectural shape

The code is **feature-based**, not type-based. Each user-facing surface is a
self-contained slice under `src/features/`. The app/ directory is a thin
routing layer and should stay that way.

### Feature categories (apps/web)

Features in `src/features/` fall into three categories. The category determines
what a feature is allowed to import from.

**Product surfaces** — own a page, render tiles, orchestrate user journeys:

| Feature | Route |
|---|---|
| `dashboard` | `/` |
| `evidence` | `/evidence` |
| `checkin` | `/checkin` |
| `settings` | `/settings` |
| `pr-reviews` | `/pr-reviews` |
| `goals` | `/goals` |
| `onboarding` | `/onboarding` |
| `chat` | overlay |

**Shared domains** — cross-cutting data, hooks, or logic consumed by many surfaces:

`auth` · `hubs` · `integrations` · `goal-specs` · `goal-inputs` · `goal-context`
· `goal-tiers` · `snapshots` · `grading` · `goal-widgets`

**Platform utilities** — infrastructure helpers with no page of their own:

`analyst` · `command-palette` · `companion` · `migrate` · `prefs`

Import rules by category:

- ✅ Product surface → shared domain (barrel only, never deep path)
- ✅ Product surface → platform utility (barrel only)
- ✅ Shared domain → other shared domain (barrel only)
- ✅ Any feature → `components/ui`, `components/shell`, `lib/*`
- ❌ Shared domain → product surface
- ❌ Platform utility → product surface or shared domain (except `analyst` → `prefs`)
- ❌ Any deep cross-feature path — the architecture-boundaries test enforces this

```
src/
├── app/                              # Next.js App Router — thin.
│   ├── layout.jsx                    # Loads fonts, mounts <Toaster>.
│   ├── page.jsx                      # → <DashboardPage />
│   ├── evidence/page.jsx             # → <EvidencePage />
│   ├── snapshots/page.jsx            # → <SnapshotsPage />
│   ├── settings/page.jsx             # → <SettingsPage />
│   ├── onboarding/page.jsx           # → <OnboardingPage />
│   ├── oauth/github/                 # OAuth callback (client component)
│   ├── api/                          # Stateless API proxies
│   │   ├── jira/[...path]/route.js
│   │   ├── gitlab/[...path]/route.js
│   │   ├── github/[...path]/route.js
│   │   └── oauth/github/exchange/route.js
│   └── globals.css                   # Design tokens + Tailwind theme mapping
│
├── components/
│   ├── ui/                           # Presentational primitives. No logic.
│   │   ├── bento-tile.jsx
│   │   ├── button.jsx                # The ONE button — all CTAs use it
│   │   ├── card.jsx
│   │   ├── checkbox.jsx
│   │   ├── delta.jsx
│   │   ├── dither-field.jsx          # Dither + DitherDisc + DitherBars
│   │   ├── grain.jsx                 # Page noise overlay
│   │   ├── input.jsx                 # Input + Field
│   │   ├── mono-label.jsx
│   │   ├── page-header.jsx           # Editorial H1 w/ italic-serif accent
│   │   ├── pill.jsx
│   │   ├── section.jsx               # "01 / Something" section header
│   │   ├── sparkline.jsx
│   │   ├── star-glyph.jsx
│   │   ├── stat.jsx
│   │   └── index.js                  # Barrel — always import from here
│   └── shell/                        # Page chrome (header, footer, grain)
│       ├── app-shell.jsx             # Composes the whole frame
│       ├── header.jsx
│       ├── footer.jsx
│       └── logo-mark.jsx             # Hex-dot SVG logo
│
├── features/                         # Domain slices. Each is self-contained.
│   ├── integrations/                 # Cross-cutting — the provider layer.
│   │   ├── providers.js              # PROVIDERS metadata
│   │   ├── integrations-store.js     # localStorage CRUD (no React)
│   │   ├── use-integrations.js       # React hook over the store
│   │   ├── api-clients/              # One file per provider (jira/gitlab/github)
│   │   │   ├── proxy-fetch.js        # Shared transport → /api/{provider}/...
│   │   │   ├── jira.js · gitlab.js · github.js
│   │   │   └── index.js
│   │   ├── hooks/                    # SWR hooks — one per resource
│   │   │   ├── use-swr-if.js         # Conditional SWR wrapper
│   │   │   ├── use-jira-tickets.js
│   │   │   ├── use-gitlab-open-mrs.js
│   │   │   ├── use-gitlab-merged.js
│   │   │   ├── use-gitlab-events.js
│   │   │   ├── use-github-pulls.js
│   │   │   └── index.js
│   │   ├── metrics/                  # Pure derivations. No React, no IO.
│   │   │   ├── merged.js · turnaround.js · rounds.js
│   │   │   ├── linkage.js · reviews.js · activity.js
│   │   │   ├── attention.js
│   │   │   └── index.js
│   │   └── index.js                  # Public surface
│   │
│   ├── dashboard/
│   │   ├── dashboard-page.jsx
│   │   ├── hero.jsx
│   │   ├── attention-band.jsx
│   │   ├── tiles/                    # One file per bento tile (12 total)
│   │   │   ├── integrations-tile.jsx · merged-tile.jsx
│   │   │   ├── rounds-tile.jsx · linkage-tile.jsx
│   │   │   ├── tickets-tile.jsx · prs-tile.jsx
│   │   │   ├── activity-tile.jsx · turnaround-tile.jsx
│   │   │   ├── reviews-tile.jsx · snapshots-tile.jsx
│   │   │   ├── export-tile.jsx · commits-tile.jsx
│   │   │   └── index.js
│   │   └── index.js
│   │
│   ├── evidence/
│   │   ├── evidence-page.jsx
│   │   ├── config-panel.jsx · document-preview.jsx · evidence-picker.jsx
│   │   ├── evidence-store.js · use-evidence.js
│   │   ├── markdown-export.js        # Pure renderer + download helpers
│   │   └── index.js
│   │
│   ├── snapshots/
│   │   ├── snapshots-page.jsx · trend-chart.jsx
│   │   ├── snapshots-store.js · use-snapshots.js
│   │   └── index.js
│   │
│   ├── settings/
│   │   ├── settings-page.jsx · token-forms.jsx
│   │   ├── tabs/                     # integrations · account · snapshots-prefs · danger
│   │   └── index.js
│   │
│   └── onboarding/
│       ├── onboarding-page.jsx · wizard.jsx
│       ├── dashboard-preview.jsx · value-props.jsx
│       └── index.js
│
└── lib/                              # Framework-agnostic helpers.
    ├── cn.js                         # classname merge (tailwind-merge + clsx)
    ├── date.js                       # weekLabel, isoDaysAgo, shortDate, ...
    ├── fmt.js                        # fmtNumber, fmtDays, fmtPct, fmtRelative
    ├── oauth-pkce.js                 # GitHub OAuth starter
    └── regex.js                      # JIRA_KEY_RE
```

## Rules of the road

### 1. Features are the boundary

A feature slice owns its page, its components, its hooks, and its local store.
Don't cross-import `features/evidence` from `features/dashboard`; if something
is shared, it lives in `features/integrations` (data) or `components/ui`
(presentation).

Imports allowed (see Feature categories above for the full matrix):

- ✅ `features/x` → `components/ui`, `components/shell`, `lib/*`
- ✅ `features/x` → its own subfolders
- ✅ product surface → shared domain or platform utility (barrel import only)
- ✅ shared domain → other shared domain (barrel only)
- ❌ Any deep cross-feature import not in the `allowedDeepImports` list in
  `src/features/architecture-boundaries.test.js`

### 2. Three-layer discipline inside each feature

1. **Data layer** — `*-store.js` (localStorage) + `use-*.js` hooks.
   Pure CRUD, no UI.
2. **Logic layer** — `metrics/*.js`, `markdown-export.js`, etc.
   Pure functions. Easy to test.
3. **Presentation layer** — `*-page.jsx` + component files.
   No data I/O beyond consuming a hook.

If a file does all three, split it.

### 3. The API proxy is dumb on purpose

`/api/{provider}/[...path]` forwards the request 1:1 to the upstream provider,
attaching the token from `x-devhub-*` headers. **Do not** add derived endpoints
or business logic there — the server is stateless and the proxy is just a
CORS/auth bridge. All metric derivation happens client-side in
`features/integrations/metrics/*`.

### 4. Tokens never leave the browser except as Authorization headers

Every provider token lives in `localStorage` under
`espace-devhub:integrations`. When calling a provider, we send the token to our
own Next route, which sets `Authorization: Bearer <token>` upstream. We don't
log the token, don't cache responses on the server, and don't have a DB. The
settings page advertises this contract — don't violate it without updating the
privacy-first copy.

### 5. Design tokens are the source of truth

All colors, fonts, radii live as CSS variables in `globals.css` and are mapped
into Tailwind v4 via `@theme inline`. If you need a new shade, add the token
first; don't hard-code hex in components. Exception: the `MergedTile` /
`ExportTile` solid-accent tiles use `#ffffff` explicitly for white text on
accent — that's deliberate, since `--accent-on` may one day diverge from white.

### 6. "As a tech lead" checklist for new code

- [ ] Does this belong in an existing feature, or does it need a new one?
- [ ] Is the file named after its primary export (kebab-case files, PascalCase
      React components, camelCase functions)?
- [ ] Did you add to a barrel `index.js` so callers import from the feature
      root, not a deep path?
- [ ] Does the component do one thing? (If it has a state machine _and_ a data
      fetcher _and_ a render — split it.)
- [ ] If it touches localStorage, did you broadcast via a change event so
      sibling tabs/hooks stay in sync?
- [ ] Did you keep the API proxy dumb?
- [ ] Did you match the HexaCore aesthetic (mono labels, serif italic accent
      word, dither textures, hairline borders, 4px radii)?

## Running it

```bash
cp .env.example .env.local   # fill NEXT_PUBLIC_JIRA_URL + NEXT_PUBLIC_GITLAB_URL
npm install
npm run dev                  # http://localhost:3000
```

## What's real vs. stubbed

| Feature | Live data | Source |
|---|---|---|
| Dashboard tickets | ✅ | Jira `/search/jql` |
| Dashboard PRs (mine + review) | ✅ | GitLab `merge_requests` + GitHub search |
| Merged this week + trend | ✅ | GitLab `merge_requests?state=merged` |
| Turnaround histogram | ✅ | Derived from merged MRs |
| Linkage % | ✅ | Regex over merged MR titles/descriptions |
| Reviewer comments | ✅ | `user_notes_count` on merged MRs |
| Reviews given | ✅ | GitLab `/events?action=commented` |
| Activity timeline | ✅ | GitLab `/events` bucketed daily |
| Recent commits | ✅ | GitLab `/events?action=pushed` |
| Attention band | ✅ | Derived from open MRs + Jira tickets |
| Snapshots | ✅ localStorage | Captured on "Snapshot now" |
| Evidence export (.md) | ✅ | Client-side renderer → blob download |
| Evidence export (.pdf) | ⚠️ browser print | `window.print()` — a proper path
needs `@react-pdf/renderer` |

## Open questions

See `.design-reference/README.md` — the Codex Design handoff covers these
in detail. Notable ones still open:

1. Accent swap — prototype uses `#3826ff` Electric; if the team wants the
   PRD's cobalt `#1D4ED8`, change one CSS var.
2. Proper "review rounds" requires per-MR `/discussions` calls (N+1); current
   implementation is `user_notes_count` as a proxy.
3. Snapshot cron — server action (Vercel Cron) vs. client-side detection on
   Monday open. v0 is manual "Snapshot now".

# eSpace Dev Hub — engineering guide

> Personal performance dashboard + evidence tracker for eSpace engineers.
> Pulls live data from Jira, self-hosted GitLab and GitHub into one bento grid.
> This file is the canonical reference for _where things go_ and _why_.

## Stack

- **Next.js 16** App Router, JSX (no TS).
- **Tailwind v4** CSS-variables-first. Tokens in `src/app/globals.css`.
- **Fonts (Nothing UI):** Doto (dot-matrix display / big numerals), Hanken Grotesk
  (display + sans/body), Space Mono (mono / labels). Loaded via Google Fonts
  `@import` in `globals.css` (`--font-dot`, `--font-display`, `--font-sans`, `--font-mono`).
- **SWR** for all remote data. No React Query.
- **Recharts** for the snapshot trend chart only; other charts are hand-rolled SVG
  (sparkline, dither fields, bars) to keep the Nothing UI aesthetic crisp.
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
| `intelligence` | `/[hub]` (Goal Intelligence Hub — Dev home) |
| `goals` | `/[hub]/goals` (goals tree + evidence tiles + AI-tracked widgets; `goals-page/`) |
| `goals-flow` | `/[hub]/goals-v2` (flow-map preview, reachable via ⌘K) |
| `evidence` | `/[hub]/evidence` |
| `settings` | `/[hub]/settings` |
| `pr-reviews` | `/[hub]/reviews` |
| `snapshots` | `/[hub]/snapshots` (also a shared domain — the store) |
| `onboarding` | `/onboarding` |
| `landing` | `/` signed-out (root gate → landing or hub redirect) |
| `chat` | overlay |

Hub-specific pages (manager / admin / qa surfaces) live under `src/hubs/<hub>/`,
not `src/features/`. The legacy perf dashboard (`features/dashboard`) and the
check-in slice are gone; `/[hub]/checkin` only redirects old bookmarks.

**Shared domains** — cross-cutting data, hooks, or logic consumed by many surfaces:

`auth` · `hubs` · `integrations` · `goal-specs` · `goal-inputs` · `goal-context`
· `goal-tiers` · `goal-locks` · `goal-widgets` · `goal-editors` · `snapshots`
· `grading` · `notifications` · `date-range`

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
apps/web/src/
├── app/                              # Next.js App Router — thin.
│   ├── layout.jsx                    # Fonts, no-flash theme script, <Toaster>
│   ├── page.jsx                      # → <RootGate /> (landing or hub redirect)
│   ├── [hub]/                        # Every product page is hub-prefixed
│   │   ├── page.jsx                  # dev → Intelligence · manager → Team · admin/qa → Overview
│   │   ├── goals/ · goals-v2/ · evidence/ · snapshots/ · reviews/ · settings/
│   │   ├── employees/ · delegated/ · approvals/ · tier-policies/   # manager
│   │   ├── users/ · audit/ · hub-config/                            # admin
│   │   └── checkin/                  # redirect only (retired slice)
│   ├── onboarding/ · login/ · oauth/github/
│   └── globals.css                   # Design tokens + Tailwind theme mapping
├── pages/api/v1/[...path].ts         # API catch-all (bundled topology / companion routing)
│
├── components/
│   ├── ui/                           # Presentational primitives. No logic.
│   │   ├── button.jsx                # The ONE button — all CTAs use it
│   │   ├── input.jsx                 # Input + Field
│   │   ├── use-focus-trap.js         # Dialog focus trap
│   │   ├── bento-tile · card · pill · mono-label · page-header · section
│   │   ├── sparkline · line-spark · bars · dither-field · grain · loader …
│   │   └── index.js                  # Barrel — always import from here
│   └── shell/                        # Header (hamburger < md, ⌘K chip), footer, app-shell
│
├── hubs/                             # Hub-specific pages (NOT features)
│   ├── dev/ · manager/ · admin/ · qa/
│   └── dashboard-registry.jsx        # slot → component
│
├── features/                         # Domain slices — see "Feature categories"
│   ├── intelligence/                 # Dev home: focus hero, health grid, action queue
│   ├── goals/                        # Goals editor, import, past cycles, goals-page/ (route body)
│   ├── goals-flow/                   # Flow-map preview (/goals-v2)
│   ├── evidence/                     # Evidence board, document builder, .md/.pdf export, pdf/
│   ├── snapshots/                    # Store + page + capture-readings (per-goal readings) + compliance summary
│   ├── goal-specs/ · goal-inputs/ · goal-context/ · goal-locks/ · goal-tiers/
│   ├── goal-widgets/                 # Widget resolver, data-sources/use-data-source (provenance), cadence stepper
│   ├── goal-editors/ · grading/ · notifications/ · date-range/
│   ├── integrations/                 # Provider layer: api-clients/, hooks/ (SWR), metrics/ (pure), refresh.js
│   ├── analyst/ · command-palette/ · companion/ · migrate/ · prefs/
│   ├── auth/ · hubs/ · landing/ · onboarding/ · settings/ · pr-reviews/ · chat/
│   └── architecture-boundaries.test.js  # Enforces barrel-only cross-feature imports
│
└── lib/                              # Framework-agnostic helpers.
    ├── api-client.js                 # fetch wrapper: 401 redirect, companion-offline toast
    ├── cn.js · date.js (weekNumber, dueStatus, …) · fmt.js · regex.js (hasJiraKey)
    └── oauth-pkce.js

apps/api/src/
├── modules/<name>/{routes,controller,schemas}.ts   # one Express module per resource
├── scheduler/                        # Hourly jobs: nudges, digest, weekly snapshots (idempotent via scheduler_stamps)
├── middleware/                       # session, require-auth/-capability/-role, companion-proxy, rate-limit
├── lib/                              # email, notifications, audit, goal-tier-policies, companion-routing …
└── db/                               # collections.ts (accessors + indexes), schemas/ ($jsonSchema validators), types.ts
```

The landing page (`features/landing`) deliberately ships its own scoped
dark-only palette under `.lp` — it's a marketing surface, not a themed app
screen; don't "fix" it onto the app tokens.

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
- ✅ shared domain → other shared domain (barrel import only)
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

### 4. Tokens are encrypted at rest and used server-side only

Provider tokens are stored **envelope-encrypted at rest in Mongo**
(`INTEGRATION_TOKEN_KEY`) and decrypted only inside the API process, which
attaches them as `Authorization` headers upstream via the integrations proxy
(`apps/api/src/modules/integrations/proxy.ts`). Tokens are never logged and
never echoed back to the browser after save. Goals, readings, snapshots, and
grades are server-persisted per account (and manager-readable where the role
model says so) — the app is NOT localStorage-only anymore. The settings page's
privacy copy mirrors this contract — keep the two in sync. Key custody /
rotation: see BL-004 in `docs/backlog.md`.

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
- [ ] Did you match the Nothing UI aesthetic (mono labels, dot-matrix Doto
      titles/accent word, dot-grid textures, dashed hairlines, 8px radii,
      light + dark via the `--*` tokens in globals.css)?

## Running it

```bash
cp .env.example .env.local   # fill NEXT_PUBLIC_JIRA_URL + NEXT_PUBLIC_GITLAB_URL
npm install
npm run dev                  # http://localhost:3000
```

## What's real vs. stubbed

| Feature | Live data | Source |
|---|---|---|
| AUTO goal widgets (merged count, review rounds, turnaround, linkage, first-pass rate) | ✅ | GitLab `merge_requests` + GitHub search, YTD, per-spec repo filter; GitHub review comments hydrated for the 30 most recent PRs |
| Ticket cycle time | ⚠️ sample | Jira `/search/jql` — 50 most-recently-updated, resolved >90d excluded (provenance chip says so) |
| CI/CD widgets (deploy freq, lead time, pass rate) | ⚠️ last 100 | Jenkins / GitHub Actions, capped at 100 builds |
| Manual widgets (counter, scale, date log, incidents, composed…) | ✅ | `goal_inputs` via API, cadence windows from `goal-inputs/cadence-windows.js` |
| Tier grading | ✅ | AI verdicts (`goal_tier_verdicts`) · manager verdicts outrank · manager tier POLICIES by Goal Code, scoped per year |
| Snapshots | ✅ server-persisted | Captured on dashboard visit + "Snapshot now"; the API scheduler freezes unvisited weeks (manual trackers only, `partial: true`) |
| Scheduler | ✅ | `apps/api/src/scheduler/` — hourly: due/overdue/stale nudges, approval waits, Monday digest email, weekly snapshots |
| Notifications | ✅ | Inbox rows + 90s bell poll + email (Resend, log-mode without a key); rows deep-link |
| Review packets | ✅ | Frozen markdown per submission; managers read + download; latest headline shows on the team board |
| Cycle archives | ✅ | Replace-import freezes the tree + a per-goal report card (`goal_cycles`); "Past cycles" viewer |
| Evidence export (.md / .pdf) | ✅ | Client renderer → blob; `@react-pdf/renderer` (dynamic import) |
| Companion (Crealogix) | ✅ | Desktop app tunnels `/integrations/*`; a stale heartbeat now 502s provider routes instead of serving cloud data |
| Performance cycles model | ✗ by convention | Cycle = calendar year everywhere (#227); no `performance_cycles` collection |

## Open questions

See `.design-reference/README.md` — the Claude Design handoff covers these
in detail. Notable ones still open:

1. ~~Accent swap~~ — RESOLVED: cobalt `#1D4ED8` won (`--accent` in
   `globals.css`), with per-hub accents layered on top by the hub registry.
2. Proper "review rounds" requires per-MR `/discussions` calls (N+1); current
   implementation is `user_notes_count` as a proxy (tracked as BL-012).
3. ~~Snapshot cron~~ — RESOLVED (F4, #229): the API scheduler
   (`apps/api/src/scheduler/`) freezes last week server-side for any user
   who didn't capture it by visiting — manual trackers only, stamped
   `partial: true, gaps: ["provider-metrics"]`. Client visit-capture still
   provides the full (provider-metric) snapshot and wins over auto.

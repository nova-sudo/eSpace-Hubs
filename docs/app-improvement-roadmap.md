# eSpace Dev Hub improvement roadmap

Date: 2026-06-13

## Objective

Make eSpace Dev Hub easier to trust and use during review season, while
reducing architecture drift and adding a regression-testing path that can grow
without a heavy tooling migration.

## Current read

The product has outgrown the original single-Next-app guide. The current repo is
a monorepo with:

- `apps/web`: Next 16 UI with hubs, auth, analyst, check-in, evidence, settings,
  snapshots, and dashboard surfaces.
- `apps/api`: Express + MongoDB service with auth, encrypted integrations,
  versioned API routes, audit logging, roles, hubs, companion routing, and
  provider proxying.
- `packages/shared`: shared hub/capability/goal-spec contracts.

That evolution is good, but the operating model is now more complex than the
guide suggests. The architecture docs should describe the server-authoritative
stores, cross-cutting domains, and integration-token model as they exist today.

## UX strategy

For this product, CASTLE is a better measurement frame than HEART. Engineers do
not need a "more engaging" dashboard; they need a reliable work surface that
reduces review-prep effort.

North Star candidate:

> Weekly evidence-ready reviews completed without manual spreadsheet cleanup.

CASTLE goals:

- Cognitive load: users can understand "what changed, what needs action, and
  what can prove my work" in one scan.
- Actionability: every empty/error/attention state has a clear next action.
- Satisfaction: review prep feels calm rather than performative.
- Trust: every metric exposes source, freshness, and calculation assumptions.
- Learnability: a new engineer can connect tools and capture a snapshot without
  reading docs.
- Efficiency: the primary dashboard should answer review-prep questions in
  under two minutes.

## Priority roadmap

### P0 - Regression spine

Status: started.

- Added metric regression tests for merge windows, Jira linkage, turnaround
  buckets, and review timing.
- Added a feature-boundary ratchet that blocks new deep cross-feature imports
  unless they are explicitly allowlisted as migration debt.
- Added `npm run test:regression` at the repo root and web workspace.

Next:

- Run this command in CI before build.
- Add API regression tests around `buildApp()` with mocked Mongo collections or
  a test database.
- Add one browser smoke suite once Playwright is installed: auth-off landing,
  auth-on redirect, dashboard empty states, settings integration save.

### P1 - Trust-first dashboard UX

Problem:

The dashboard is memorable, but daily users need scanability. Strict
viewport-sized scroll sections, hidden scrollbars, section-level loading, and
fixed header-height math make the page feel more like a presentation than an
operational tool.

Recommended changes:

- Add an "Overview table / Compact mode" toggle for repeat daily use.
- Keep scroll sections as a presentation mode, not the only dashboard mode.
- Replace hard-coded `57px` header math with a CSS variable owned by the shell.
- Let tiles render independent loading/error/empty states instead of blocking an
  entire section when only one data source is slow.
- Add source freshness labels to every metric tile, for example
  "GitLab synced 2m ago" or "Jira disconnected".

### P1 - Empty state and setup flow

Problem:

The app has many token-backed surfaces. If a provider is missing, expired, or
slow, users need a recovery path in-place, not just a blank metric.

Recommended changes:

- Create a shared `ProviderStateCallout` for disconnected, misconfigured,
  timeout, and partial-data cases.
- Put "Connect / Reconnect / Retry / Open settings" actions directly inside the
  affected tile.
- Add a settings health summary showing provider status, last used, last error,
  and which dashboard tiles depend on each provider.

### P1 - Evidence workflow clarity

Problem:

Evidence export is the product's strongest review-season value, but the path
from metric to evidence packet is split across dashboard, snapshots, check-in,
analyst, and evidence surfaces.

Recommended changes:

- Add a review-prep rail or checklist: connect sources, capture snapshot, review
  goal inputs, generate evidence.
- Add "used in evidence" markers on dashboard metrics and goal widgets.
- Record snapshot provenance: date range, source counts, unavailable providers,
  and generation mode.

### P2 - Architecture boundaries

Problem:

The original rule "features only import integrations" is no longer true. The app
now has legitimate shared domains such as `auth`, `hubs`, `goal-specs`,
`goal-inputs`, `snapshots`, and `analyst`. Without a new rule, imports will keep
drifting.

Recommended changes:

- Reclassify features into:
  - product surfaces: dashboard, evidence, check-in, settings, reviews;
  - shared domains: auth, hubs, integrations, goal-specs, goal-inputs,
    snapshots, grading;
  - platform utilities: command palette, companion, migrate, prefs.
- Require cross-feature imports to use the target feature barrel.
- Promote intentional deep imports into public exports, especially:
  `analyst/use-ai-provider`, `dashboard/date-range`,
  `integrations/api-clients/proxy-fetch`, `prefs/prefs-store`, and
  `goal-widgets/widgets/scorecard-subspec`.
- Move dashboard date range into a neutral reporting/date-range module if it is
  meant to be shared by reviews and settings.

### P2 - Server/client data ownership

Problem:

Several comments still describe localStorage-primary behavior even when stores
are now API-backed or server-authoritative. This hurts maintainability and can
mislead security/privacy decisions.

Recommended changes:

- Maintain a storage registry documenting every key, owner, persistence layer,
  migration status, and clear-on-auth behavior.
- Update user-facing privacy copy to reflect encrypted server-side integration
  tokens where applicable.
- Add tests for cross-user storage clearing on login, logout, signup, invite
  acceptance, and session user changes.

## Testing ladder

Current:

- Unit-level regression for pure metrics.
- Static boundary regression for feature coupling.
- API typecheck.

Next:

- API tests: health, auth error envelopes, proxy header allowlist, timeout
  shaping.
- Store tests: session transitions, storage clearing, migration idempotency.
- Component tests: tile loading, empty, error, and disconnected-provider states.
- E2E smoke tests: first-run route, auth redirect, dashboard no-token state,
  settings connect flow, evidence export happy path.

## Verification notes

- `npm run test:regression` passes.
- `npm run typecheck` passes.
- Local Next server responds on `http://localhost:3000`.
- In-app browser automation was blocked by a Browser runtime setup-path error,
  and Playwright is not installed in the repo, so responsive/pixel validation is
  still a follow-up.

# eSpace Dev Hub improvement execution plan

Date: 2026-06-13

Source: `docs/app-improvement-roadmap.md`

## Planning premise

The app should become a trust-first review-prep workspace. Engineers should be
able to answer three questions quickly:

1. What changed in my work window?
2. What needs my action?
3. What evidence can I safely use in review?

The roadmap has five workstreams. We should not start them all at once. The
best sequence is:

1. Stabilize tests and CI gates.
2. Improve trust and recovery states.
3. Add compact daily-use dashboard paths.
4. Clarify evidence prep.
5. Pay down architecture/documentation drift.

## Success metrics

North Star:

- Weekly evidence-ready reviews completed without manual spreadsheet cleanup.

Operational metrics:

- Dashboard first useful state under 3 seconds with disconnected providers.
- No full-section loader blocks unrelated tiles after the P1 dashboard pass.
- 100 percent of metric tiles expose source state: fresh, disconnected,
  degraded, or unavailable.
- Evidence prep flow completes in 4 steps or fewer.
- `npm run test:regression` runs in CI before build.
- No new deep cross-feature imports outside the architecture allowlist.

## Workstream map

| Stream | Goal | First deliverable |
| --- | --- | --- |
| Regression | Prevent metric and boundary regressions | CI runs `npm run test:regression` |
| Trust states | Make provider/data failures actionable | Shared provider state callout |
| Dashboard UX | Support daily scanning, not only presentation | Compact overview mode |
| Evidence workflow | Make review prep linear and auditable | Review-prep checklist |
| Architecture | Make current monorepo rules explicit | Feature boundary guide update |

## Phase 0 - Stabilize the runway

Target: 0.5 to 1 day.

Purpose:

- Make the existing regression spine part of the development loop.
- Remove ambiguity around what is intentionally dirty versus newly changed.

Tickets:

### P0.1 Wire regression command into CI

Scope:

- Add a CI step that runs `npm run test:regression`.
- Place it before build so cheap failures stop early.

Acceptance criteria:

- CI fails if a metric regression test fails.
- CI fails if a new deep feature import is added without updating the allowlist.
- CI output shows the Node test summary.

Notes:

- Keep the command separate from `npm run typecheck` so failures are easy to
  diagnose.

### P0.2 Clean generated-file noise policy

Scope:

- Decide how `apps/web/next-env.d.ts` should be treated after Next dev/typecheck.
- Add a short note to docs or `.gitattributes` if line endings keep causing
  false modified status.

Acceptance criteria:

- Starting the dev server does not leave unexplained generated-file noise.
- The policy is documented for future agents and engineers.

## Phase 1 - Trust states before layout surgery

Target: 2 to 4 days.

Purpose:

- Users should know whether a metric is real, partial, stale, or unavailable.
- Empty states should answer "what can I do now?"

Tickets:

### P1.1 Provider dependency map

Scope:

- Create a small shared map that lists which dashboard tiles depend on which
  providers.
- Include Jira, GitLab, GitHub, Jenkins, snapshots, goal inputs, and manual
  context where relevant.

Acceptance criteria:

- The map is pure data.
- Dashboard tiles and settings can both consume it.
- No token or provider fetch logic moves into the map.

Candidate location:

- `apps/web/src/features/integrations/provider-dependencies.js`

### P1.2 Shared provider state callout

Scope:

- Add a reusable UI primitive for disconnected, misconfigured, timeout,
  degraded, and empty provider states.
- Include action slots for "Connect", "Reconnect", "Retry", and "Open
  settings".

Acceptance criteria:

- Uses existing UI primitives and tokens.
- Works inside compact tiles without overflowing.
- Has accessible `role="status"` or equivalent announcement where appropriate.
- Does not hard-code provider-specific logic in the component.

Candidate location:

- `apps/web/src/components/ui/provider-state-callout.jsx` if purely
  presentational.
- `apps/web/src/features/integrations/provider-state-callout.jsx` if it needs
  provider metadata.

### P1.3 Settings integration health summary

Scope:

- Add a compact health summary to the integrations settings tab.
- Show provider connection status, last used, last error, and affected
  dashboard surfaces.

Acceptance criteria:

- Users can tell which broken provider is causing which broken metric.
- No secrets are rendered.
- Copy reflects the current encrypted server-side token model, not the old
  localStorage-only model.

### P1.4 Tile-level source state

Scope:

- Apply provider state callouts to the highest-value dashboard tiles first:
  merged, review timing, tickets, open PRs, linkage, snapshots.

Acceptance criteria:

- A missing Jira token does not make unrelated GitLab/GitHub metrics look
  broken.
- A provider timeout gives a recovery suggestion.
- Empty data is distinct from disconnected data.

## Phase 2 - Compact daily dashboard

> **Status: shipped (commit b55cae5), then removed.** P2.1 and P2.2 were
> built as described below, but the compact/presentation toggle was later
> pulled out entirely — `features/dashboard/use-dashboard-view.js` and
> `features/dashboard/compact-dashboard.jsx` no longer exist, and
> `DashboardPage` always renders the presentation `ScrollShell`. Kept here
> for history; do not treat P2.1/P2.2 as open work.

Target: 3 to 5 days.

Purpose:

- Preserve the current scroll-snap dashboard as a presentation mode.
- Add a repeat-use mode optimized for scanning and review prep.

Tickets:

### P2.1 Dashboard view mode preference

Scope:

- Add a dashboard view mode preference: `presentation` and `compact`.
- Store it using the existing preferences pattern.

Acceptance criteria:

- The default can remain current presentation mode.
- Switching modes is immediate and persists for the user/device according to the
  chosen storage pattern.
- The mode switch does not affect date-range state.

### P2.2 Compact overview page

Scope:

- Build a compact dashboard layout that surfaces:
  - source health;
  - merged and review timing;
  - attention items;
  - goal compliance;
  - latest snapshot/evidence state.

Acceptance criteria:

- No hidden scrollbar dependency.
- No full-viewport section requirement.
- Text fits at common laptop widths.
- Users can reach detailed pages from each section.

### P2.3 Remove hard-coded header-height math

Scope:

- Replace repeated `57px` dashboard header calculations with a shared CSS
  variable owned by the shell.

Acceptance criteria:

- Scroll shell and sections read the same variable.
- Header height changes no longer require editing dashboard internals.
- Existing presentation mode still snaps correctly.

## Phase 3 - Evidence prep workflow

Target: 3 to 5 days.

Purpose:

- Turn evidence export from a destination page into a guided workflow.

Tickets:

### P3.1 Review-prep checklist

Scope:

- Add a checklist surface that tracks:
  - providers connected;
  - current date range selected;
  - snapshot captured;
  - goal inputs reviewed;
  - evidence generated.

Acceptance criteria:

- Checklist is visible from dashboard and evidence.
- Each step has a direct action.
- Completed steps are derived from real app state, not independent checkboxes.

### P3.2 Snapshot provenance

Scope:

- Store or render provenance for generated snapshots/evidence:
  - date range;
  - provider source counts;
  - unavailable providers;
  - manual versus auto generation.

Acceptance criteria:

- Evidence preview can explain where each metric came from.
- Exported markdown includes enough context for review discussions.

## Phase 4 - Architecture documentation and debt payoff

Target: parallel with Phases 1 to 3, but not blocking.

Purpose:

- Make the current monorepo architecture explicit so future work does not keep
  inheriting an outdated single-app guide.

Tickets:

### P4.1 Update architecture guide

Scope:

- Rewrite the feature-boundary section around current categories:
  - product surfaces;
  - shared domains;
  - platform utilities.

Acceptance criteria:

- The guide matches `apps/web`, `apps/api`, and `packages/shared`.
- It names allowed cross-feature import patterns.
- It explains the architecture-boundary regression test.

### P4.2 Promote deep imports to public barrels

Scope:

- For each allowlisted deep import, either:
  - export it from the feature barrel; or
  - document why it remains migration debt.

Acceptance criteria:

- The allowlist shrinks over time.
- No consumer reaches into internal files without intent.

### P4.3 Storage registry

Scope:

- Create a storage registry documenting localStorage keys, server-backed stores,
  migrations, and clear-on-auth behavior.

Acceptance criteria:

- Each key has owner, purpose, data shape, persistence layer, and clearing
  policy.
- Privacy/security copy can be reviewed against the registry.

## Recommended first sprint

Duration: 1 week.

Commitment:

1. P0.1 Wire regression command into CI.
2. P1.1 Provider dependency map.
3. P1.2 Shared provider state callout.
4. P1.4 Apply tile-level source state to two pilot tiles: tickets and merged.
5. P4.1 Update architecture guide with current monorepo categories.

Why this sprint:

- It directly improves trust.
- It keeps the work small enough to verify.
- It creates reusable primitives before the compact dashboard work starts.
- It reduces architecture ambiguity while product UX changes are beginning.

Out of scope for first sprint:

- Full compact dashboard mode.
- Playwright/browser smoke suite.
- Snapshot provenance persistence.
- Major visual redesign.

## Decision log

| Decision | Default | Reason |
| --- | --- | --- |
| Measurement frame | CASTLE | Mandatory workplace tool; trust and efficiency beat engagement |
| First UX target | Provider/data states | Trust problems compound every other dashboard issue |
| First test target | Pure metrics and boundaries | Fast, deterministic, no browser or token setup |
| Dashboard strategy | Add compact mode, keep presentation mode | Avoid throwing away distinctive current UX |
| Architecture strategy | Ratchet, then refactor | Prevent new drift before paying down old drift |


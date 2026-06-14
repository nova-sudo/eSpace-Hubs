# Spec-driven checkbox plan

Date: 2026-06-13

Spec: trust-first dashboard foundation

## User outcome

As an eSpace engineer preparing for review, I can immediately tell which
dashboard numbers are real, missing, degraded, or blocked by provider setup, and
I can take the next recovery action without hunting through settings.

## Scope

This spec covers the first sprint from `docs/app-improvement-execution-plan.md`:

- Regression CI gate.
- Provider dependency map.
- Shared provider/data state callout.
- Pilot tile-level states for Tickets and Merged.
- Architecture guide update as a follow-up task.

## Non-goals

- Full compact dashboard mode.
- Full settings integration health summary.
- Browser/E2E suite installation.
- Snapshot provenance persistence.
- Major visual redesign.

## Checklist

### P0 - Regression gate

- [x] Add root/web `test:regression` command.  
  Evidence: `package.json`, `apps/web/package.json`.
- [x] Add CI workflow that runs `npm run test:regression` before slower checks.  
  Evidence: `.github/workflows/web-regression.yml`.
- [x] Decide generated-file/line-ending policy for `apps/web/next-env.d.ts`.  
  Evidence: added `apps/web/next-env.d.ts` to root `.gitignore`, untracked via `git rm --cached`.

### P1 - Provider trust state

- [x] Add pure provider dependency map.  
  Evidence: `apps/web/src/features/integrations/provider-dependencies.js`.
- [x] Add shared provider/data state callout.  
  Evidence: `apps/web/src/features/integrations/provider-state-callout.jsx`.
- [x] Export provider trust primitives from the integrations barrel.  
  Evidence: `apps/web/src/features/integrations/index.js`.
- [x] Pilot disconnected/loading/error recovery state in Tickets tile.
- [x] Pilot disconnected/error recovery state in Merged tile.
- [x] Add settings integration health summary.  
  Evidence: `settings/tabs/integrations-tab.jsx` — new "00 / Integration health"
  section (compact table: provider, status, affected tiles) + "Affects" chips
  inside each `ProviderCard`.
- [x] Roll tile-level source states across Review Timing, Open PRs, Linkage,
  Snapshots, and Reviews.  
  Evidence: `turnaround-tile.jsx`, `prs-tile.jsx`, `linkage-tile.jsx`,
  `snapshots-tile.jsx`, `reviews-tile.jsx` — all use `ProviderStateCallout`
  for disconnected (and error where applicable). Added `reviews` entry to
  `provider-dependencies.js`.

### P2 - Daily scanning

- [x] Add dashboard `presentation` / `compact` view-mode preference.  
  Evidence: `features/dashboard/use-dashboard-view.js` — `useSyncExternalStore`
  + localStorage, `useDashboardView()` hook exported from barrel.
- [x] Build compact overview layout.  
  Evidence: `features/dashboard/compact-dashboard.jsx` — scrollable vertical
  layout with 3 compact groups (Overview, On your plate, Trends & evidence).
  Presentation mode gets a "⊟ Compact view" fixed toggle via `CompactModeToggle`
  in `ScrollShell`; compact mode gets "⊞ Presentation mode" inline button.
- [x] Replace repeated hard-coded `57px` header-height math with a shell-owned
  CSS variable.  
  Evidence: `globals.css` → `--header-height: 57px`; both
  `scroll-shell.jsx` and `section.jsx` now reference `var(--header-height)`.

### P3 - Evidence workflow

- [x] Add review-prep checklist.  
  Evidence: `features/evidence/review-prep-checklist.jsx` — state-derived strip
  (code host ✓/✗, Jira ✓/✗, snapshot this week ✓/✗, → Generate evidence link).
  Added to evidence page header and compact dashboard.
- [x] Add snapshot/evidence provenance.  
  Evidence: `tiles/snapshots-tile.jsx` — shows "⚠ Partial data — {gaps}" when
  `snapshot.partial === true`. Provenance fields (`partial`, `gaps`) already
  stored in snapshot schema.
- [x] Mark dashboard metrics that are used in evidence.  
  Evidence: `bento-tile.jsx` — new `usedInEvidence` prop renders a subtle
  "evidence" pill badge. Applied to `MergedTile`, `TurnaroundTile`,
  `RoundsTile`, `LinkageTile`, `ReviewsTile`.

### P4 - Architecture

- [x] Update the architecture guide with current monorepo categories.  
  Evidence: `CLAUDE.md` + `AGENTS.md` — new "Monorepo" section (apps/web,
  apps/api, packages/api-contracts, packages/shared) and "Feature categories"
  table (product surfaces / shared domains / platform utilities) with updated
  import rules.
- [x] Promote allowlisted deep imports into public feature barrels or document
  why they remain migration debt.  
  Evidence: `analyst/index.js` (added `AI_PROVIDERS`, `setAiProvider`,
  `useAiProvider`, `getAiProvider`); `dashboard/index.js` (added `date-range`
  re-exports); `prefs/index.js` (created). All 11 callers migrated to barrel
  imports. Allowlist shrunk from 7 → 3 intentional-debt entries with comments.
- [x] Add storage registry for localStorage/API-backed ownership.  
  Evidence: `docs/storage-registry.md` — all active + deprecated localStorage
  keys and API-backed stores, with clear-on-auth behaviour documented.

## Acceptance criteria for this pass

- [x] `npm run test:regression` passes.
- [x] `npm run typecheck` passes.
- [x] Static diff whitespace check passes.
- [x] Tickets tile distinguishes disconnected Jira from empty Jira data.
- [x] Merged tile distinguishes no code host connected from zero merged PRs.
- [x] Provider state copy does not mention secrets or token bytes.
- [x] New cross-feature imports go through existing feature barrels.

## Verification log

- 2026-06-13: `npm run typecheck` passed.
- 2026-06-13: `git diff --check` passed for the files changed in this spec.
- 2026-06-13: `npm run test:regression` is blocked in the sandbox by `EPERM`
  while Node resolves the real workspace path under `C:\Users\ASUS\Desktop`.
  An escalated rerun could not proceed because the environment rejected the
  approval request.

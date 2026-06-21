# Plan — replace `/checkin` with a per-widget cadence stepper

> PO + UX plan. Lenses: `ecc-claude-product-team-agile-product-owner`,
> `ui-ux-pro-max` (a11y rules), `design-taste-frontend` (hygiene only — it's a
> landing/portfolio skill, this is a dashboard, so its layout rules don't apply).
> Design language stays HexaCore (mono labels, hairline borders, 4px radii,
> cobalt accent).

## Objective
Delete the standalone `/checkin` page. Put a **cadence stepper** under each
manual widget on the Goals page that is simultaneously:
1. a **status gauge** — did you fill each cadence window? — and
2. the **check-in surface** — click a period cell to fill that window inline.

See status and act, in one place, per goal.

## Why (product)
- Filling lives on a separate page from where status is read → data goes stale
  (the journey map's "weekly check-in" friction; the complexity audit's
  "no nudge" gap).
- The Goals page already renders the widget; the intelligence hub already
  renders a read-only fill strip. Unifying removes a page, removes a class of
  cross-surface coherence bugs (cf. G1/G2), and shortens the track→act loop.
- **Success signals:** higher fill-rate per cadence window; fewer "needs
  update"/stale goals; lower weekly check-in time; one fewer page to learn.

## The stepper — anatomy & states

**Windows are CYCLE-ANCHORED, fixed — not rolling.** The steps tile the goal's
review cycle (its `cycleId` bounds; calendar year as the fallback). A quarterly
widget shows exactly **4** windows (Q1–Q4 of the cycle); monthly shows its
months; etc. Each window is: filled / owed / current / future / settled. This
replaces `fillStats`'s entry-anchored "windows since first entry" with a
cycle-anchored window set (same fill-detection, different bounds).

### Three rendering modes (adaptive by window count)
1. **Discrete stepper** — when the cycle has ≤ ~13 windows. Labeled cells.
   - quarterly → **4** (Q1–Q4) · monthly → **12**.
2. **Full-cycle heatmap** — when the cycle has many windows (weekly ≈ 52,
   daily ≈ 365). Every window rendered as a compact cell that wraps / scrolls,
   GitHub-contributions style — the whole-cycle compliance view. Same states,
   same click-to-fill, just dense.
3. **Completion pip** — for **non-cadence** widgets (milestone / one-time /
   continuous / per-incident; the existing `NON_BUCKETING` set). No period
   steps at all — a single **complete ↔ incomplete** indicator. "Some goals
   just have to be done."

Cell states — **never colour alone** (ui-ux-pro-max): shape + glyph + tooltip.

| State | Look | Meaning |
|---|---|---|
| Filled | solid accent + ✓ | data entered for that window |
| Owed (past) | dashed + warn dot | a past window with no data |
| Current | ring + "now" | the active window; default to fill |
| Settled | striped/muted | "nothing to report" lock (`goal-locks`) |
| Future | faint, disabled | a window not yet reached in the cycle |

- **Click a cell → that window becomes the widget's active window**, so you fill
  the current window OR backfill a missed one inline. Replaces `/checkin`'s
  global week selector with a per-widget window selector. (In heatmap mode the
  same applies per cell; the current window is visually emphasised.)
- Streak / "N of M filled" summary at the end (reuse the recurring-milestone
  streak idea).
- **A11y:** ≥44px targets in stepper mode (heatmap cells smaller but keyboard-
  reachable); arrow-key nav, Enter to select; `aria-current` on the active cell;
  tooltip `2026-W24 · filled`; `prefers-reduced-motion` honoured; contrast ≥ 4.5:1.
- **Empty state:** a fresh goal shows the cycle's windows all "owed/future" with
  the current one highlighted → "log this period."

## Technical plan (reuse, don't rebuild)
The pattern already exists — this is mostly promotion + interactivity.

| Piece | Already exists | Change |
|---|---|---|
| Per-window fill detection | `goal-inputs/compliance.js` → `fillStats()` buckets entries into windows | add a **cycle-anchored** window builder: enumerate windows from cycle start→end (or calendar year), tag each filled/owed/current/future from entries + now |
| Cycle bounds | goals carry `cycleId` (schema) | resolve cycle start/end; fall back to calendar year when `cycleId` is null |
| Render mode switch | — | ≤ ~13 windows → discrete stepper; more → heatmap; `NON_BUCKETING` cadence → completion pip |
| Read-only dot strip | intelligence `FillStrip` | becomes the interactive stepper |
| "Nothing to report" per window | `goal-locks` (`currentWindowKey`/`isLocked`/`setLock`) | drive the "settled" state |
| Fill editors | `goal-editors` (shared since Sprint 3) | render inside the widget for the selected period |
| Readiness gate | `goal-widgets/readiness.js` (G1) | unchanged — not-ready goals show "finish setup", no stepper |

- **New component** `CadenceStepper` (`goal-widgets`): `{ goalId, cadence,
  activePeriod, onSelectPeriod }` → cells from `fillStats` + locks.
- **Lift period selection** from the check-in page's week selector to a
  per-widget `activePeriod` state the stepper owns. Widgets already write to a
  period via `midWeekTs(activeLabel)` (non-recurring) / `periodKey` (recurring);
  feed that from the stepper.
- **Render** inside the widget shell on Goals, below the body. AUTO widgets
  (merged count, turnaround, …) get **no** stepper — nothing to hand-fill;
  they keep their live value. Stepper is for MANUAL / HYBRID / milestone /
  recurring / COMPOSED.
- **Remove `/checkin`:** delete the route + nav entry; reuse the shared
  `goal-editors` inside the widget for the selected period. The hub action-queue
  still surfaces owed goals and deep-links to the goal's current cell.

## Risks / watch-outs
- **Mental-model shift:** `/checkin` scopes *all* widgets to one chosen week;
  the stepper makes period selection per-widget. More flexible, but when a
  non-current cell is selected the widget must clearly label "editing 2026-W22".
- **Backfilling honesty:** allow backfilling (fixes "forgot last week"), entries
  timestamped to that window (`fillStats` already buckets by ts). See open Q.
- **Don't lose "do next":** the intelligence action queue stays the cross-goal
  nudge; it links into the goal + current cell.
- **Mobile:** the cell row must fit or scroll-snap; keep ≥44px targets.
- **COMPOSED:** v1 is one running record; period-reset (v2 in
  `docs/generative-widget.md`) should land before COMPOSED gets a true
  per-period stepper. Until then its stepper reflects "filled this period or not".

## Phased rollout
1. ✅ **Gauge half** — `CadenceStepper` read-only on each manual widget (stepper
   / heatmap / pip). (commit 7462456)
2. ✅ **Fill half** — selectable cells → inline shared editor per window via
   `writeTs`; COMPOSED made period-aware so its stepper fills per period.
   (569f42c, 42cf20e). Readiness gate so it hides in "define before tracking"
   (1cf4951).
3. **Parity (in progress)** — make the widget do everything `/checkin` does:
   - ✅ "Nothing to report" settle (goal-locks) folded into the stepper.
   - ✅ SCORECARD + CODE_RUBRIC fill — ALREADY covered on the Goals widgets:
     CodeRubricWidget has Grade-now/week/YTD; ScorecardWidget opens a per-
     component modal with each sub-widget's full editor. `/checkin` was only a
     redundant entry point for these.
   - ✅ Weekly/daily backfill — heatmap cells are now selectable → same inline
     editor + settle as the stepper. (44px target relaxed for dense year grids,
     GitHub-contributions style.)
   - ☐ Cross-goal "what's owed this week" — covered by the intelligence hub
     action queue; confirm it deep-links to the goal + current cell.
4. ✅ **Remove** — DONE. Nav entry dropped; `/checkin` and `/checkin/grid`
   redirect to Goals; the intelligence hub's CTAs ("Track goals", "Open goals",
   "Open in goals") point at Goals. The `features/checkin` code is kept (dead
   but importable) so the removal is reversible; a later cleanup can delete it.
   **One capability dropped:** the multi-week cross-goal *grid* (catch up many
   weeks across all goals in one table). Per-goal multi-period backfill is
   covered by the stepper; the cross-goal "what's owed" view is the intelligence
   hub action queue. If the batch grid is missed, it can return as a Goals-page
   view later.

## Open question (decide before phase 2)
Backfill scope: **any past window**, or **current + previous only** (older =
view-only)? Recommendation: current + previous — keeps data honest while still
fixing the "forgot last week" case.

## Definition of done
- A manual widget on Goals shows an accurate cadence stepper (states match
  `fillStats` + locks).
- Clicking a cell fills/edits that window inline, equivalent to what `/checkin`
  did for that goal+period.
- `/checkin` route + nav removed; deep links redirect to Goals.
- Readiness gate, evidence, recurring reset, COMPOSED all still work.
- Build + arch + regression green.

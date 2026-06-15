# Product Strategy — Goal Intelligence Hub

Date: 2026-06-14  
Status: Approved direction, Sprint 1 ready to build

## Core business need

Users track their goals and fill in check-in data so the system can analyse
performance and generate intelligent feedback. The integration data (GitLab,
Jira, GitHub) is a means to auto-populate goal inputs — not the product itself.

## User loop

```
Set Goals → Fill Check-in Data → Get Intelligent Feedback → Compile Evidence
```

---

## Page audit & verdict

| Page | Route | Verdict |
|---|---|---|
| Performance Dashboard | `/[hub]` | REPLACE — bento of raw integration tiles; surface goal intelligence instead |
| Goals | `/[hub]/goals` | KEEP & PROMOTE — centre of gravity |
| Check-in | `/[hub]/checkin` | KEEP & ENHANCE — primary data entry |
| Check-in Grid | `/[hub]/checkin/grid` | KEEP — backfill flow |
| Evidence | `/[hub]/evidence` | ABSORB — fold into BI page as "Compile review package" action |
| Snapshots | `/[hub]/snapshots` | ABSORB — becomes history/timeline inside BI page |
| PR Reviews | `/[hub]/reviews` | REMOVE — integration data already feeds goal widgets; standalone redundant |
| Settings | `/[hub]/settings` | KEEP — integration setup lives here |
| Audit / Hub Config / Users | admin routes | KEEP — no change |

## New navigation (4 items)

```
Intelligence  ·  Goals  ·  Check-in  ·  Settings
```

---

## New Home: Goal Intelligence Hub (`/[hub]`)

Replaces the performance bento entirely. Four zones:

### Zone 1 — AI Status Narrative (top, full width)
Generative text from `analyst` feature. Inputs:
- `goal-inputs` fill rates
- `goal-tiers` verdicts (ahead / on track / behind)
- `snapshots` trend history
- Cadence windows from `goal-specs`

Example: *"You're ahead on Code Quality and on track with 4 other goals.
Jira Linkage hasn't been filled in 3 weeks and is falling behind target.
Two L2 goals have no data at all — click to fill them now."*

Falls back to rule-based summary if AI provider not configured.

### Zone 2 — Goal Health Grid (main body)
One card per L1 goal; L2 goals nested. Each card:
- Fill rate: this week + rolling 4 weeks (e.g. "3/4 weeks filled")
- Status chip: Ahead · On track · Behind · No data · Not classified
- Last entry date
- Trend arrow (last 3 readings)
- "Fill now" CTA if unfilled this week

Existing hooks: `useGoalWidgetItems`, `useGoalInputs`, `useGoalSpecs`, `useGoalTier`

### Zone 3 — Action Queue (sidebar or bottom strip)
Derived automatically:
- Goals with no entry this cadence window → "Fill now"
- Goals past cadence window → "Overdue" badge
- Goals with tier verdict ready → "Review verdict"
- Unfilled weeks → "You have 2 unfilled weeks" → link to grid

### Zone 4 — Evidence Export (collapsed)
`ReviewPrepChecklist` already exists. Surface as "Compile review package →"
linking to `/evidence`. Not in nav — accessible from BI page only.

---

## Check-in enhancements

1. Auto-populated rows — goals whose spec uses integration data (GitLab PRs,
   Jira tickets) show the system-computed value alongside the manual input
2. Completion progress bar — "7 of 9 goals filled this week"
3. Gap banner → one-click to open grid at first unfilled week

## Goals page enhancements

1. Spec assignment clarity — show "no spec yet" vs "classified as CODE_RUBRIC"
2. Last-filled indicator — show last entry date per goal in the list

---

## What to remove

- Performance bento tiles as standalone surface (merged PRs, turnaround, rounds,
  linkage, reviews-given tiles) — keep the data calls, kill the tile surface
- PR Reviews page
- Snapshots as top-level nav
- Compact/presentation dashboard toggle (no longer needed)

---

## Build order

Items tagged **(backlog)** were added after Sprint 1 shipped — enhancements
that surfaced from the hub's actual shape. They're slotted into the sprint
where they fit best; reorder freely.

### Sprint 1 — Foundation (no AI needed) ✅ SHIPPED (commit 1862dd8)
- [x] Replace `/[hub]` with Goal Intelligence Hub shell
- [x] Goal Health Card: fill rate + status chip + last-entry + "Fill now" CTA
- [x] Action Queue strip: unfilled / overdue goals from existing hooks
- [x] Remove PR Reviews from nav (renamed Dev tab "Performance" → "Intelligence")
- [x] New `features/intelligence/` slice (status.js, use-goal-health.js, cards,
  grid, action-queue, status-narrative) + `fillStats()` in goal-inputs

Known Sprint-1 simplifications, carried forward as backlog (see Sprint 2):
fill label is weekly-worded for all cadences; fill dots show count not which
windows.

### Sprint 2 — Intelligence layer ✅ SHIPPED (commit 8e180e2)
- [x] Status Narrative is AI-INFORMED + deterministic — names the worst goal
  by name + trend language. (Decision: NOT a per-load LLM call — too slow /
  token-costly per page view. The AI signal is the cached tier verdict on
  cards; a future on-demand "summarise with AI" button can use the exported
  `ruleBasedNarrative()` as its fallback.)
- [x] Narrative names the actual worst goal (from `queue[0]`)
- [x] Goal tier verdict inline on Health Cards — reuses `GoalTierBadge`
  (cached daily grade, self-hides when no tiers), beside the rule-based pill
- [x] Trend arrow from recent snapshots, goodness-aware via target op
- [x] Trend language in the narrative ("improving" / "slipping")
- [x] Cadence-aware fill label ("/ 4 months", "/ 4 quarters")
- [x] Fill dots show WHICH windows were filled (per-window pattern, gaps visible)
- [ ] **(deferred)** Auto-goal cards show the live computed value + target
  ("12 PRs · target ≥10 ✓") — needs per-goal integration data via
  goal-widgets `useDataSource`; moved to Sprint 3 alongside the other
  integration-data work
- [ ] **(not done)** Tier-verdict COUNTS in the narrative — skipped on purpose:
  in focus view only attention cards mount their badge, so only those goals
  get graded; an aggregate tier count would be skewed. Revisit if/when all
  goals are graded eagerly.

### Sprint 3 — Check-in enhancement + inline fill
- [x] **HEADLINE: Inline fill from the hub** ✅ SHIPPED (commit cd96abe) —
  "Fill now ▾" on a card expands the right editor inline (scoped to the most-
  recent completed work week), writes to goal-inputs immediately, card updates
  live. Took architecture option (a): new shared domain `features/goal-editors`
  (editors git-moved out of check-in; both surfaces consume the barrel).
  `GoalManualEditor` + `isInlineFillable()` gate which kinds fill inline
  (counter, scale, milestone, free-text, date-log, before-after, incident,
  recurring) vs link to /checkin (rubric, scorecard).
  - [x] *Follow-up DONE (96e854b):* Action Queue rows now fill inline too
    (`Fill ▾`), not just link out.
- [x] Auto-populated values ✅ SHIPPED (commit e8ac1db) — hub auto-goal cards
  now show the live computed value + target ("12 merged · target ≥10 ✓") via
  `AutoGoalValue` reusing goal-widgets `useDataSource`. (Check-in auto-readouts
  for these goals already existed.) CI/CD trio + rubric/scorecard fall back to
  the generic note — mapping their headlines is a small follow-up.
- [x] Completion progress bar ✅ SHIPPED (commit 55ba775) — check-in shows
  "X / Y goals logged this week" with a live bar (auto goals excluded), green
  "All caught up" when done.
- [~] Gap banner → actionable one-click to grid — banner already links to the
  grid ("Catch up N weeks"); remaining nicety is landing on the FIRST unfilled
  week rather than the grid top. Minor; left as polish.
- [x] **Overdue escalation** ✅ SHIPPED (commit 7252523) — a goal dark for 2+
  consecutive windows reads "Overdue" (hard red) on card + queue; queue sorts
  most-overdue-first; narrative names it "is overdue". Via `statusDisplay()`.
- [ ] **(backlog)** Snapshot-this-week signal in the Action Queue (tie the
  existing `ReviewPrepChecklist` in so "capture this week's snapshot" is an action)

### Sprint 4 — Clean-up + depth
- [ ] Absorb snapshots as history tab inside BI page
- [ ] Surface evidence compile as primary BI page action
- [ ] Remove compact/presentation toggle
- [ ] Retire old dashboard feature slice (+ `/reviews`, `/snapshots` routes)
- [ ] **(backlog)** Goal weightage on cards — eSpace goals carry `weightage`;
  emphasise high-weight goals and weight the L1 rollup by it
- [ ] **(backlog)** L1 rollup chip in each group header ("3 / 5 on pace") so
  parent goals are scannable without reading every card
- [ ] **(backlog)** Goal drill-in — clicking a card opens a goal detail page
  (`/[hub]/goals/[goalId]`?) with history sparkline, all entries, inline edit.
  This is also where absorbed snapshots get their home

### Icebox — bigger, unscheduled
- [ ] **(backlog)** Grid sort/filter — by status, L1, or weight, for users with
  many goals
- [ ] **(backlog)** Streaks — "5 weeks logged in a row" as positive
  reinforcement, not just nagging
- [ ] **(backlog)** Stale-goal nudges — in-app or email reminders when a goal
  goes dark (needs backend / `apps/api` work)
- [ ] **(backlog)** Manager / team aggregate view — roll health up across a team
  (the `manager` hub is already a registry placeholder)

---

## Status model rethink (post-real-data review, 2026-06-15)

Real goal data exposed a conceptual flaw: the hub infers everything from
"is there an entry in the rolling window ending now?" — which can't tell apart
three very different states:

- "I haven't logged this window yet" (genuinely owed)
- "Nothing happened this window" (legitimately empty)
- "This is finished / done" (complete)

It also conflated **data hygiene** (did you log?) with **target attainment**
(did you hit the number?), so a 100%-complete checklist showed "Behind target"
and landed in "Do next".

### Immediate fixes ✅ SHIPPED (commit 83165f4)
- [x] Object-valued widgets (recurring-milestone, milestone, incident,
  before-after) no longer run through `computeCompliance` (which coerced their
  object value to `NaN` → false "behind"). Only numeric widgets (counter,
  scale, date-log) get target grading; the AI tier judges the rest.
- [x] `BEHIND` removed from `NEEDS_ATTENTION` — a behind goal is filled, so it's
  a performance SIGNAL (card chip), not a "Do next" chore.

### The rethought model (to build)
Two **independent** axes, plus explicit per-window state:

1. **Fill status (data hygiene)** — per cadence window, a window is `filled`,
   `empty`, or `locked`. Only `empty` windows drive "Do next".
2. **Performance status (the metric)** — on filled data: on-pace / behind /
   ahead. A signal, never an action. The AI tier sits on top for achievement.

Concrete work this unlocks:
- [ ] **(rethink) Name the missing window** — replace "2 / 4 quarters" with the
  specific gap: "Q1, Q2 logged · Q3 (current) empty", and have "Fill" target
  THAT window. Tells the user exactly what's owed instead of a ratio.
- [ ] **(rethink) Lock / finalize a window** — a control to mark a window done
  or "nothing to report", so it stops counting as owed. The user's escape hatch
  from rolling-window nagging (the "maybe they didn't actually do it that week"
  case). Needs a per-goal-per-window `locked` flag in goal-inputs (or a sibling
  store) + UI on the card/check-in + status logic that treats locked-empty as
  not-owed.
- [ ] **(rethink) Track from goal start, not blindly N windows back** — a goal
  tracked for 2 quarters shows "2 / 4" as if 2 were missed, but those windows
  predate the goal. Anchor the window count to first-entry / goal-creation so
  the denominator is honest.

---

## Key risks

1. **Integration setup discoverability** — with tiles gone, users need Settings
   to be obvious. AI narrative can prompt: "Connect GitLab to auto-fill PR goals."
2. **AI narrative cold start** — build rule-based summary first; upgrade to
   generative in Sprint 2.
3. **Grid density** — 20+ L2 goals becomes a list. Default to "unfilled / at-risk
   only" with a "show all" toggle.
4. **Evidence page** — keep route, remove from nav, link from BI page only.

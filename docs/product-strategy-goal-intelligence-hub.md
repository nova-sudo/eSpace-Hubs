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

### Sprint 1 — Foundation (no AI needed)
- [ ] Replace `/[hub]` with Goal Intelligence Hub shell
- [ ] Goal Health Card: fill rate + status chip + last-entry + "Fill now" CTA
- [ ] Action Queue strip: unfilled / overdue goals from existing hooks
- [ ] Remove PR Reviews from nav

### Sprint 2 — Intelligence layer
- [ ] Wire `analyst` to generate Status Narrative from goal-inputs + goal-tiers
- [ ] Goal tier verdict inline on Health Cards
- [ ] Trend arrow from last 3 snapshots per goal

### Sprint 3 — Check-in enhancement
- [ ] Auto-populated values for integration-backed goals
- [ ] Completion progress bar
- [ ] Gap banner → actionable one-click to grid

### Sprint 4 — Clean-up
- [ ] Absorb snapshots as history tab inside BI page
- [ ] Surface evidence compile as primary BI page action
- [ ] Remove compact/presentation toggle
- [ ] Retire old dashboard feature slice

---

## Key risks

1. **Integration setup discoverability** — with tiles gone, users need Settings
   to be obvious. AI narrative can prompt: "Connect GitLab to auto-fill PR goals."
2. **AI narrative cold start** — build rule-based summary first; upgrade to
   generative in Sprint 2.
3. **Grid density** — 20+ L2 goals becomes a list. Default to "unfilled / at-risk
   only" with a "show all" toggle.
4. **Evidence page** — keep route, remove from nav, link from BI page only.

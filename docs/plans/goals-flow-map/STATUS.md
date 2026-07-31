# Goals flow map — implementation status

Design source: the `design_handoff_goals_flow_map` bundle (`README.md`,
`FEATURE_PARITY.md`, `AUDIT_PASS1.md`, `PASS2_RESOLUTIONS.md`,
`Goals Map.dc.html`), reviewed against `nova-sudo/eSpace-Hubs@main`.

Route: `/[hub]/goals-v2`, dev-hub only, gated by the `goalsv2` hub slot,
**not in the nav** — reachable only by direct URL. `/[hub]/goals` (the
current two-section page) is completely untouched.

## What's built (Phases 1–8)

| Phase | Status | Where |
|---|---|---|
| 1. Scaffolding | Done | `flow-geometry.js` (pure, unit-tested), `goals-flow-page.jsx` |
| 2. Core interaction | Done | expand/collapse + reflow, owed-only (hide + collapse empty groups), density toggle, per-L1 collapse + collapse/expand-all |
| 3–6. Widget bodies, cadence, tiers, readiness, actions | Done, via reuse | `flow-row.jsx` mounts the SAME `<GoalWidget>` + `<GoalTierLadder>` the current Goals page uses — see below |
| 7. Evidence drawer | Done | `evidence-drawer.jsx` — resolves B1/B2/B3 |
| 8. Accessibility | Done | `role="tree"`/`role="group"`/`role="treeitem"`, roving tabindex, arrow-key nav, live region |

## The reuse strategy (read this before reviewing the code)

`GoalWidget` already implements the FULL readiness/widget/action state
machine used everywhere else in the app (untrackable / pending-approval /
delegated / needs-context / ready, all ~15 widget kinds, all 3 cadence
modes + nested cadences, the window panel, the full action footer).
`GoalTierLadder` already implements the Final ladder (5 verdict states,
consistency cap, 3-way governance treatment). The flow row mounts both,
rather than re-implementing any of that logic against the flow map's own
visual shell.

**Trade-off this creates, on purpose:** the expanded row's content looks
like the current tile UI (`WidgetShell`'s card styling) sitting inside the
flow row's card, not the bespoke flat blocks (`detail`/`components`/
`items`/`fields`) `Goals Map.dc.html` mocks up pixel-for-pixel. Functional
behavior is 100% at parity with the rest of the app (same hooks, same
stores, nothing forked) — the visual restyling of the INSIDE of an
expanded row to match the mockup's bespoke layout is real, sizeable work
that was consciously deferred in favor of correctness and reuse. This is
the single biggest visual gap vs. the reference design; everything else
(ghost rows, notices, drawer, a11y, scale controls) was built new to match
the mockup's actual behavior.

## Known simplifications / open items

- **Expanded-row height is a fixed placeholder** (`LAYOUT.open = 640px`,
  scrolls internally past that) rather than measured against the real
  mounted content. A DOM-measured reflow (ResizeObserver per open row)
  would match the design's "rows reflow around the real height" spec more
  precisely — not done, scoped as a follow-up if 640px proves wrong in
  testing for tall widget kinds (SCORECARD, COMPOSED with many fields).
- **Nested-cadence UI** is whatever `CadenceStepper`'s `NestedStepperLevel`
  already renders (unchanged) — not restyled to the mockup's dashed
  "Weekly sub-periods · inside Q3" treatment.
- **Notice-block visual treatment** for not-ready states is whatever each
  state-shell component (`UntrackableCard`, `PendingApprovalCard`,
  `ContextCollector`, `DelegatedCard`) already renders — not unified into
  the mockup's single parameterized notice block.
- **Collapsed-row "value"** is deliberately NOT shown — only the kind
  label, title, tier chip, and a readiness dot. The mockup's tile/row
  headline value is computed per-kind inside each widget file; centralizing
  it for the collapsed summary was judged not worth duplicating that logic
  for a Phase-1–8 pass. The tier color is the primary at-a-glance signal
  instead (this matches the design's own stated intent that tier color is
  the primary status signal).
- **"Analyze N unclassified" and ghost-row "Classify with AI"** both open
  the existing bulk Analyst overlay (`ANALYST_MODES.ANALYSIS`) rather than
  a new per-goal classify action — there's no existing per-goal classify
  entry point elsewhere in the app to point to instead.

## Before cutover (flipping `/goals` → this page)

1. Live walkthrough against the testing checklist (separate doc).
2. Decide whether the visual-fidelity gap above needs closing first, or
   ships as a v1 with a follow-up polish pass.
3. Decide the sub-800px stacked-layout treatment — Phase 1's `layoutFlow`
   doesn't yet implement a distinct narrow-width mode (the original
   handoff explicitly left this "not yet designed"; the current page
   just lets the canvas's own `minCanvas` floor create horizontal scroll
   below ~560px content width, which is not the same as a real stacked
   fallback).
4. Retire, per `FEATURE_PARITY.md` §C: the structured tree tile, the
   two-section scroll-snap shell, the section rail/counter, the 3-column
   widget grid — only once this page is confirmed as the replacement, not
   before.
5. Add the route to nav and remove the `/goals-v2` "not yet linked"
   posture.

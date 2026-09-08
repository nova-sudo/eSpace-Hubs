# Goals flow map — implementation status

Design source: the `design_handoff_goals_flow_map` bundle (`README.md`,
`FEATURE_PARITY.md`, `AUDIT_PASS1.md`, `PASS2_RESOLUTIONS.md`,
`Goals Map.dc.html`), reviewed against `nova-sudo/eSpace-Hubs@main`.

Route: **`/[hub]/goals`** — cut over. The flow map is the Goals page for
every hub that exposes the `goals` slot (dev, qa), in the nav and behind
`HubSlotGate slot="goals"`. `/[hub]/goals-v2` now only redirects here.
The old two-section page (`features/goals/goals-page/`) is kept but
unrouted; reverting is swapping one component in the route file.

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

## Cutover — done, with these still open

The route swap shipped (`/goals` renders this page; `/goals-v2` redirects;
the ⌘K "preview" entry folded into the plain Goals entry). What the
pre-cutover checklist listed as prerequisites and what's now follow-up:

1. Live walkthrough against the testing checklist (separate doc) — still
   worth doing against the real route.
2. The visual-fidelity gap above ships as v1; the polish pass to the
   mockup's bespoke expanded-row layout is a follow-up.
3. Sub-800px stacked layout is still undesigned — `layoutFlow` has no
   distinct narrow-width mode, so below ~560px content width the canvas's
   `minCanvas` floor produces horizontal scroll rather than a real stacked
   fallback. Highest-priority follow-up now that this is the main page.
4. Not yet retired, per `FEATURE_PARITY.md` §C: the structured tree tile,
   the two-section scroll-snap shell, the section rail/counter, the
   3-column widget grid. The code is unrouted, not deleted — delete once
   this page is confirmed in use.

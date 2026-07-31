# Goals flow map — live testing checklist

Route: `/[hub]/goals-v2` on the **dev hub**, logged in as a dev-hub user
with a classified goal tree (mix of widget kinds, at least one unclassified
L2, at least one cadenced goal that's currently owed, ideally one that's
manager-governed via `/manager/tier-policies`).

## 1. Page load + layout (Phase 1)

- [ ] Page loads without console errors.
- [ ] Title bar shows the right L1/tracked/unclassified counts.
- [ ] Every L1 card sits on the left; every classified L2 branches off it
      via an orthogonal connector to a row.
- [ ] No horizontal scrollbar on the canvas at 1280px, 1600px, and a
      maximized ultrawide width.
- [ ] Resize the window — the canvas width, connector paths, and row
      positions all re-derive smoothly (no stale/clipped connectors).

## 2. Expand / collapse + reflow (Phase 2)

- [ ] Click a row — it expands in place; rows below it (in the same L1
      group AND in later L1 groups) shift down to make room.
- [ ] Click the same row again — it collapses; everything reflows back up.
- [ ] Open a different row while one is already open — the first one
      closes (only one open at a time).
- [ ] Open a row whose content is tall (a SCORECARD or a COMPOSED goal with
      many fields) — content scrolls INSIDE the row rather than overflowing
      into the next row. Note if 640px feels too short in practice.

## 3. Density + group collapse (Phase 2)

- [ ] Click "Dense" — rows shrink, the label flips to "Comfortable".
- [ ] Click the chevron on an L1 card — its rows disappear, the card stays
      with a "N goals" count, and the L1 card's own position doesn't jump.
- [ ] "Collapse all" collapses every L1 group and the button relabels to
      "Expand all"; clicking it again restores every group.

## 4. Owed-only filter (Phase 2)

- [ ] The "Owed only" count matches the number of goals with at least one
      unlogged, unsettled cadence window.
- [ ] Toggling it ON hides every goal with nothing owed, AND hides any L1
      group that becomes empty as a result (not just dims them).
- [ ] Toggling it OFF restores everything.
- [ ] Fill or settle ("nothing to report") a window on an owed goal — the
      owed count updates live without a manual refresh.

## 5. Widget kinds, cadence, both tiers (Phases 3–6, via reuse)

For as many distinct widget kinds as you have goals for (COUNTER, SCALE,
MILESTONE, RECURRING_MILESTONE, COMPOSED, SCORECARD, INCIDENT_LOG,
BEFORE_AFTER, an AUTO kind like MERGED_COUNT):

- [ ] Expanding the row shows the SAME content you'd see on the current
      `/goals` page's tile for that same goal — target chip, compliance
      line, cadence stepper, tier ladder, footer actions all present.
- [ ] For a MILESTONE or BEFORE_AFTER (single-record kinds): pip mode, not
      a stepper.
- [ ] For a weekly-cadence goal: heatmap mode renders every window, not
      truncated.
- [ ] For a COMPOSED goal with a nested cadence: the nested level opens
      inside the parent window's panel.
- [ ] Click "grade window" on an ungraded cadence window — it grades and
      shows a verdict; the criteria were visible BEFORE grading.
- [ ] The Final ladder (below the cadence stepper) shows all 4 rungs with
      "← you" on the current one.
- [ ] A manager-governed goal (set one via `/manager/tier-policies` first)
      shows "manager-governed 🔒" and no "edit" button on whichever ladder
      is governed.
- [ ] Footer actions (why?, edit setup, edit truths, delegate, build my
      own, re-analyze) all work exactly as they do on the current page.

## 6. Readiness states (Phase 6)

- [ ] A goal with unanswered context questions shows the "needs setup"
      state, not a stepper/tier.
- [ ] A delegated goal shows "judged by someone else" with no fillable
      stepper.
- [ ] An untrackable goal shows its reason, no widget body.
- [ ] A pending-approval (BYO) goal is read-only with the right note.

## 7. Ghost (unclassified) rows

- [ ] An L2 with no spec yet renders as a dashed row, dashed connector, no
      tier chip.
- [ ] Its expanded body shows "Classify with AI", not a blank/broken
      widget.
- [ ] Clicking it opens the AI Analyst overlay.
- [ ] The title bar's "Analyze N unclassified" button appears iff there are
      unclassified goals, and opens the same overlay.
- [ ] An L1 whose goals are ALL unclassified still shows its L1 card (this
      is the case `useGoalWidgetItems` doesn't cover on its own — confirm
      the merge logic actually surfaces it).

## 8. Evidence drawer (Phase 7)

- [ ] "Evidence" toggles a right-side drawer open/closed; the canvas
      reflows to make room (not overlapped).
- [ ] Snapshots section shows the latest 3 with a working "see all" link
      to `/snapshots`.
- [ ] Commits section shows recent pushes across connected providers.
- [ ] "Open evidence builder" links to `/evidence`.
- [ ] Drawer content doesn't break when there are zero snapshots / zero
      recent commits (empty states read sensibly, not blank).

## 9. Accessibility (Phase 8)

- [ ] Tab into the canvas — focus lands on exactly one row (roving
      tabindex), not every row at once.
- [ ] Arrow Down / Up moves focus between rows without moving the page
      scroll unexpectedly.
- [ ] Home / End jump to the first/last row.
- [ ] Arrow Right expands the focused row if collapsed; Arrow Left
      collapses it if open.
- [ ] Enter / Space toggles the focused row.
- [ ] A screen reader (or the accessibility tree inspector) announces each
      row's kind + title, and announces expand/collapse via the live
      region.
- [ ] Every cadence cell remains a real button with a meaningful label —
      confirm nothing regressed from the existing `CadenceStepper` a11y.

## 10. Scale

- [ ] If you can get to 8+ L1s / 25+ L2s (real data, or temporarily paste
      a bigger tree into Settings): scrolling stays smooth, reflow doesn't
      visibly lag on expand/collapse, and "Collapse all" makes a large tree
      immediately scannable.

## 11. Regression — the CURRENT `/goals` page

- [ ] Nothing about this work changed `/[hub]/goals` itself — spot check
      it still looks and behaves exactly as before.
- [ ] `/[hub]/goals-v2` is NOT reachable from the nav — only by typing the
      URL directly.

## Known gaps to expect (not bugs — see STATUS.md)

- Expanded-row visual style is the existing tile chrome, not the mockup's
  bespoke flat blocks.
- Expanded-row height is a fixed 640px placeholder with internal scroll,
  not measured against real content.
- No dedicated sub-800px stacked layout yet.
- Collapsed rows don't show a per-kind headline value, only kind + title +
  tier chip + readiness dot.

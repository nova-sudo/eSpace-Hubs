/**
 * Pure geometry for the Goals flow map (Phase 1 — structural scaffolding).
 *
 * The connectors are SVG in pixel coordinates, so the coordinate system must
 * equal the real measured pane width — a hardcoded canvas width becomes a
 * clipping cliff at some viewport size. Everything here derives from ONE
 * number (`paneW`), so `pane.scrollWidth === pane.clientWidth` holds at any
 * width. No React, no DOM — testable in isolation.
 *
 * Ported from the design handoff's `Goals Map.dc.html` prototype (geometry()
 * + elbow()), adapted to plain functions instead of a component's state.
 */

export const LAYOUT = Object.freeze({
  row: 59,
  rowDense: 44,
  // Fixed placeholder for an expanded row's height. The real thing (a
  // mounted <GoalWidget> + <GoalTierLadder>) has content-dependent height,
  // but measuring that would need a DOM read per open row on every
  // render — out of scope for the flow map's own reflow; the expanded
  // row's own internal scroll (if content exceeds this) is an accepted
  // Phase 2 tradeoff, revisited if it's a real problem in testing.
  open: 640,
  // L1 cards can grow past a single line (title clamps to 2 lines in the
  // renderer, plus label/weight/count rows) — groupGap has to clear the
  // WORST case (a 1-row group whose card is centered on that single row),
  // not the common case, or long titles overlap the next group's card.
  // See flow-geometry.test.js's "does not overlap a tall L1 card" case.
  l1Card: 150,
  gap: 13,
  groupGap: 96,
  top: 34,
  pad: 24,
  minCanvas: 560,
  stackedAt: 760,
});

/** Horizontal geometry, derived from one measured pane width. */
export function geometry(paneW) {
  const canvas = Math.max(LAYOUT.minCanvas, (paneW || 900) - LAYOUT.pad * 2);
  const l1Width = Math.round(Math.min(300, Math.max(220, canvas * 0.3)));
  const midX = l1Width + 56;
  const pillX = midX + 58;
  const cardLeft = pillX + 54;
  return {
    canvas,
    l1Left: 0,
    l1Width,
    l1Right: l1Width,
    midX,
    pillX,
    cardLeft,
    cardWidth: Math.max(280, canvas - cardLeft),
  };
}

/**
 * Orthogonal branch with rounded corners: out of the L1 anchor, a vertical
 * run at midX, then into the row's left edge. Straight line when the two
 * points are (near-)level. `r` is clamped so short branches don't overshoot
 * their own corner.
 */
export function elbowPath(ax, ay, bx, by, midX) {
  if (Math.abs(ay - by) < 2) return `M ${ax} ${ay} H ${bx}`;
  const sign = by > ay ? 1 : -1;
  const r = Math.min(16, Math.abs(by - ay) / 2, Math.abs(midX - ax), Math.abs(bx - midX));
  return (
    `M ${ax} ${ay} H ${midX - r} Q ${midX} ${ay} ${midX} ${ay + sign * r} ` +
    `V ${by - sign * r} Q ${midX} ${by} ${midX + r} ${by} H ${bx}`
  );
}

/**
 * Vertical reflow (Phase 1: every row is collapsed, fixed height — the
 * "open row is taller, everything below shifts down" behavior lands in
 * Phase 2 once rows can expand). Walks each L1 group top-to-bottom,
 * accumulating real row heights, and returns everything the renderer needs
 * in one pass: per-L1 card position + anchor Y, per-row position, per-edge
 * path, and the total canvas height.
 *
 * `groups` is the shape `useGoalWidgetItems().groupedItems` already
 * returns: `[{ l1: {id,title,category,weightage}, items: [{goal,spec}] }]`.
 * The L1's own classified-goal entry (if any) is excluded from rows — only
 * L2 children render as flow rows.
 */
export function layoutFlow(groups, paneW, opts = {}) {
  const { openId = null, density = "comfortable", collapsedL1Ids = null } = opts;
  const rowH = density === "dense" ? LAYOUT.rowDense : LAYOUT.row;
  const F = geometry(paneW);
  const l1Cards = [];
  const rows = [];
  const edges = [];
  const pills = [];
  let cursor = LAYOUT.top;

  for (const group of groups) {
    const l2Items = group.items.filter((it) => it.goal?.kind === "L2");
    if (l2Items.length === 0) continue;

    // Collapsed L1: the card renders (with its count) but none of its rows
    // do — a fixed-height placeholder advances the cursor instead of the
    // usual per-row accumulation.
    if (collapsedL1Ids?.has(group.l1.id)) {
      const top = cursor;
      l1Cards.push({
        id: group.l1.id,
        num: group.l1.id,
        title: group.l1.title,
        category: group.l1.category,
        weightage: group.l1.weightage,
        count: l2Items.length,
        collapsed: true,
        left: F.l1Left,
        top,
        width: F.l1Width,
      });
      cursor = top + LAYOUT.l1Card + LAYOUT.groupGap;
      continue;
    }

    const tops = [];
    const ys = [];
    let rowCursor = cursor;
    l2Items.forEach((item) => {
      const h = item.goal.id === openId ? LAYOUT.open : rowH;
      tops.push(rowCursor);
      ys.push(rowCursor + (item.goal.id === openId ? rowH / 2 : h / 2));
      rowCursor += h + LAYOUT.gap;
    });
    cursor = rowCursor - LAYOUT.gap + LAYOUT.groupGap;

    const anchorY = Math.round((ys[0] + ys[ys.length - 1]) / 2);
    l1Cards.push({
      id: group.l1.id,
      num: group.l1.id,
      title: group.l1.title,
      category: group.l1.category,
      weightage: group.l1.weightage,
      count: l2Items.length,
      collapsed: false,
      left: F.l1Left,
      top: Math.round(anchorY - 56),
      width: F.l1Width,
    });

    l2Items.forEach((item, i) => {
      const cy = Math.round(ys[i]);
      const isOpen = item.goal.id === openId;
      edges.push({
        id: item.goal.id,
        d: elbowPath(F.l1Right, anchorY, F.cardLeft, cy, F.midX),
        open: isOpen,
      });
      pills.push({
        id: item.goal.id,
        x: F.pillX,
        y: cy,
        label: item.spec?.widget || "",
      });
      rows.push({
        id: item.goal.id,
        goal: item.goal,
        spec: item.spec,
        left: F.cardLeft,
        top: Math.round(tops[i]),
        width: F.cardWidth,
        height: isOpen ? LAYOUT.open : rowH,
        open: isOpen,
      });
    });
  }

  return {
    canvas: F.canvas,
    height: Math.round(cursor - LAYOUT.groupGap + LAYOUT.top),
    l1Cards,
    rows,
    edges,
    pills,
  };
}

import test from "node:test";
import assert from "node:assert/strict";

import { geometry, elbowPath, layoutFlow, LAYOUT } from "./flow-geometry.js";

test("geometry derives every horizontal measurement from one pane width", () => {
  const g = geometry(1200);
  assert.equal(g.l1Left, 0);
  assert.ok(g.l1Width >= 220 && g.l1Width <= 300);
  assert.ok(g.midX > g.l1Right);
  assert.ok(g.pillX > g.midX);
  assert.ok(g.cardLeft > g.pillX);
  assert.equal(g.cardLeft + g.cardWidth, g.canvas);
});

test("geometry floors the canvas at minCanvas for a tiny pane", () => {
  const g = geometry(100);
  assert.equal(g.canvas, LAYOUT.minCanvas);
});

test("geometry is a pure function of paneW — same input, same output", () => {
  assert.deepEqual(geometry(900), geometry(900));
});

test("elbowPath draws a straight horizontal line when endpoints are level", () => {
  const d = elbowPath(0, 100, 400, 101, 150);
  assert.equal(d, "M 0 100 H 400");
});

test("elbowPath draws a rounded-corner elbow when endpoints differ vertically", () => {
  const d = elbowPath(0, 100, 400, 200, 150);
  assert.match(d, /^M 0 100 H .+ Q .+ V .+ Q .+ H 400$/);
});

test("layoutFlow places one row per L2 item, in order, non-overlapping vertically", () => {
  const groups = [
    {
      l1: { id: "l1-a", title: "Ship reliably", category: "delivery", weightage: 40 },
      items: [
        { goal: { id: "l1-a", kind: "L1" }, spec: { title: "Ship reliably" } },
        { goal: { id: "l2-a1", kind: "L2" }, spec: { widget: "COUNTER", title: "Log hours" } },
        { goal: { id: "l2-a2", kind: "L2" }, spec: { widget: "SCALE", title: "Rate alignment" } },
      ],
    },
  ];
  const layout = layoutFlow(groups, 1000);
  assert.equal(layout.rows.length, 2, "L1's own bucket entry must not become a row");
  assert.equal(layout.rows[0].id, "l2-a1");
  assert.equal(layout.rows[1].id, "l2-a2");
  assert.ok(layout.rows[1].top >= layout.rows[0].top + LAYOUT.row, "rows must not overlap vertically");
  assert.equal(layout.edges.length, 2);
  assert.equal(layout.pills.length, 2);
  assert.equal(layout.l1Cards.length, 1);
  assert.equal(layout.l1Cards[0].count, 2);
});

test("layoutFlow skips an L1 group with no L2 children entirely", () => {
  const groups = [
    {
      l1: { id: "l1-empty", title: "Nothing mapped", category: null, weightage: null },
      items: [{ goal: { id: "l1-empty", kind: "L1" }, spec: { title: "Nothing mapped" } }],
    },
  ];
  const layout = layoutFlow(groups, 1000);
  assert.equal(layout.rows.length, 0);
  assert.equal(layout.l1Cards.length, 0);
});

test("layoutFlow height covers the last row plus the top offset", () => {
  const groups = [
    {
      l1: { id: "l1-a", title: "A", category: null, weightage: null },
      items: [
        { goal: { id: "l2-1", kind: "L2" }, spec: { widget: "COUNTER", title: "One" } },
        { goal: { id: "l2-2", kind: "L2" }, spec: { widget: "COUNTER", title: "Two" } },
      ],
    },
  ];
  const layout = layoutFlow(groups, 1000);
  const lastRow = layout.rows[layout.rows.length - 1];
  assert.ok(layout.height >= lastRow.top + LAYOUT.row);
});

test("layoutFlow gives the open row the tall placeholder height and reflows rows after it", () => {
  const groups = [
    {
      l1: { id: "l1-a", title: "A", category: null, weightage: null },
      items: [
        { goal: { id: "l2-1", kind: "L2" }, spec: { widget: "COUNTER", title: "One" } },
        { goal: { id: "l2-2", kind: "L2" }, spec: { widget: "COUNTER", title: "Two" } },
      ],
    },
  ];
  const collapsed = layoutFlow(groups, 1000);
  const opened = layoutFlow(groups, 1000, { openId: "l2-1" });
  assert.equal(opened.rows[0].height, LAYOUT.open);
  assert.equal(opened.rows[0].open, true);
  assert.ok(
    opened.rows[1].top > collapsed.rows[1].top,
    "the row after the open one must shift down to make room",
  );
});

test("layoutFlow uses the dense row height when density is dense", () => {
  const groups = [
    {
      l1: { id: "l1-a", title: "A", category: null, weightage: null },
      items: [
        { goal: { id: "l2-1", kind: "L2" }, spec: { widget: "COUNTER", title: "One" } },
        { goal: { id: "l2-2", kind: "L2" }, spec: { widget: "COUNTER", title: "Two" } },
      ],
    },
  ];
  const dense = layoutFlow(groups, 1000, { density: "dense" });
  assert.equal(dense.rows[0].height, LAYOUT.rowDense);
  assert.equal(dense.rows[1].top - dense.rows[0].top, LAYOUT.rowDense + LAYOUT.gap);
});

test("layoutFlow collapses an L1's rows but keeps its card, with a count", () => {
  const groups = [
    {
      l1: { id: "l1-a", title: "A", category: null, weightage: null },
      items: [
        { goal: { id: "l2-1", kind: "L2" }, spec: { widget: "COUNTER", title: "One" } },
        { goal: { id: "l2-2", kind: "L2" }, spec: { widget: "COUNTER", title: "Two" } },
      ],
    },
    {
      l1: { id: "l1-b", title: "B", category: null, weightage: null },
      items: [{ goal: { id: "l2-3", kind: "L2" }, spec: { widget: "COUNTER", title: "Three" } }],
    },
  ];
  const layout = layoutFlow(groups, 1000, { collapsedL1Ids: new Set(["l1-a"]) });
  assert.equal(layout.rows.length, 1, "only the uncollapsed L1's row should render");
  assert.equal(layout.rows[0].id, "l2-3");
  assert.equal(layout.l1Cards.length, 2);
  assert.equal(layout.l1Cards[0].collapsed, true);
  assert.equal(layout.l1Cards[0].count, 2);
  assert.equal(layout.l1Cards[1].collapsed, false);
});

test("layoutFlow reserves enough vertical room that a 1-row group's L1 card cannot overlap the next group", () => {
  // The L1 card is centered on its group's anchor Y and spans roughly
  // [anchorY - 56, anchorY - 56 + LAYOUT.l1Card] — a real regression: a
  // single-row group with a long (line-clamped 2-line) title used to
  // render a card tall enough to visually overlap the next L1's card
  // because groupGap didn't account for the card's own height, only the
  // row's. This asserts the geometric invariant directly.
  const groups = [
    {
      l1: { id: "l1-a", title: "A", category: null, weightage: null },
      items: [{ goal: { id: "l2-1", kind: "L2" }, spec: { widget: "COUNTER", title: "One" } }],
    },
    {
      l1: { id: "l1-b", title: "B", category: null, weightage: null },
      items: [{ goal: { id: "l2-2", kind: "L2" }, spec: { widget: "COUNTER", title: "Two" } }],
    },
  ];
  const layout = layoutFlow(groups, 1000);
  const firstCardBottom = layout.l1Cards[0].top + LAYOUT.l1Card;
  assert.ok(
    layout.l1Cards[1].top >= firstCardBottom,
    `second L1 card (top=${layout.l1Cards[1].top}) must start at or after the first card's bottom (${firstCardBottom})`,
  );
});

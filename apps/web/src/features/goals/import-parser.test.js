import test from "node:test";
import assert from "node:assert/strict";

import { applyOrphanAssignments, mergeImport } from "./import-parser.js";

function l1Row(over = {}) {
  return {
    sourceId: "z-l1-1",
    code: "R-L0-3-PSCS-L1-06",
    title: "Platform stability",
    fullTitle: "R-L0-3-PSCS-L1-06: Platform stability",
    rubric: "",
    weightage: 40,
    ...over,
  };
}

function l2Row(over = {}) {
  return {
    sourceId: "z-l2-1",
    code: "R-L0-3-PSCS-L2-06-01",
    title: "Reduce incident count",
    parentTitle: "R-L0-3-PSCS-L1-06: Platform stability",
    description: "",
    rubric: "",
    weightage: 50,
    priority: "high",
    startDate: "2026-01-01",
    dueDate: "2026-12-31",
    ...over,
  };
}

test("mergeImport links L2s by exact parent title, code fallback, and orphans the rest", () => {
  const merged = mergeImport({
    l1Rows: [l1Row()],
    l2Rows: [
      l2Row(),
      // Title mismatch but the parent title still carries the L1 code:
      l2Row({
        sourceId: "z-l2-2",
        parentTitle: "R-L0-3-PSCS-L1-06 — Platform stability (renamed)",
      }),
      // No match at all:
      l2Row({ sourceId: "z-l2-3", parentTitle: "Something unknown" }),
    ],
  });

  assert.equal(merged.tree.l1s.length, 1);
  assert.equal(merged.tree.l1s[0].l2s.length, 2);
  assert.equal(merged.unmatchedL2s.length, 1);
  assert.equal(merged.unmatchedL2s[0].id, "z-l2-3");
  assert.deepEqual(merged.stats, { l1Count: 1, l2Matched: 2, l2Unmatched: 1 });
});

test("applyOrphanAssignments re-homes assigned orphans and updates stats without mutating", () => {
  const merged = mergeImport({
    l1Rows: [l1Row()],
    l2Rows: [
      l2Row({ sourceId: "z-l2-a", parentTitle: "nope" }),
      l2Row({ sourceId: "z-l2-b", parentTitle: "also nope" }),
    ],
  });
  assert.equal(merged.stats.l2Unmatched, 2);

  const out = applyOrphanAssignments(merged, {
    "z-l2-a": "z-l1-1",
    "z-l2-b": "no-such-l1", // unknown target → stays orphaned
    "stale-id": "z-l1-1", // stale key → ignored
  });

  assert.equal(out.tree.l1s[0].l2s.length, 1);
  assert.equal(out.tree.l1s[0].l2s[0].id, "z-l2-a");
  assert.equal("parentTitle" in out.tree.l1s[0].l2s[0], false);
  assert.deepEqual(
    out.unmatchedL2s.map((o) => o.id),
    ["z-l2-b"],
  );
  assert.deepEqual(out.stats, { l1Count: 1, l2Matched: 1, l2Unmatched: 1 });

  // Input untouched:
  assert.equal(merged.tree.l1s[0].l2s.length, 0);
  assert.equal(merged.unmatchedL2s.length, 2);
});

test("applyOrphanAssignments with no assignments returns the input unchanged", () => {
  const merged = mergeImport({
    l1Rows: [l1Row()],
    l2Rows: [l2Row({ parentTitle: "nope" })],
  });
  assert.equal(applyOrphanAssignments(merged, {}), merged);
});

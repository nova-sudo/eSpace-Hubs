import test from "node:test";
import assert from "node:assert/strict";

import { applyOrphanAssignments, mergeImport, parseImportFile, repairMojibake } from "./import-parser.js";

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

test("mergeImport never reuses one Zoho link id for several L1s", () => {
  // The Zoho L1 export carries the EMPLOYEE's link id on every KRA row, so
  // every objective arrives with the same ZOHO_LINK_ID. Keyed by that id,
  // the Goals page collapsed four objectives into one.
  const merged = mergeImport({
    l1Rows: [
      l1Row({ sourceId: "637720000016191500", code: "R-L0-3-PSCS-L1-01", title: "Capability" }),
      l1Row({ sourceId: "637720000016191500", code: "R-L0-3-PSCS-L1-02", title: "Uptime" }),
      l1Row({ sourceId: "637720000016191500", code: "", title: "No code" }),
    ],
    l2Rows: [],
  });
  const ids = merged.tree.l1s.map((l1) => l1.id);
  assert.equal(new Set(ids).size, 3, `duplicate ids: ${ids.join(", ")}`);
  assert.ok(ids.every((id) => id.length > 0));
  // A unique link id is still the preferred, stable id.
  const unique = mergeImport({ l1Rows: [l1Row({ sourceId: "z-1" }), l1Row({ sourceId: "z-2" })], l2Rows: [] });
  assert.deepEqual(unique.tree.l1s.map((l1) => l1.id), ["z-1", "z-2"]);
});

test("mergeImport never reuses one Zoho link id for several L2s", () => {
  const merged = mergeImport({
    l1Rows: [l1Row()],
    l2Rows: [
      l2Row({ sourceId: "dup", code: "R-L0-3-PSCS-L2-06-01" }),
      l2Row({ sourceId: "dup", code: "R-L0-3-PSCS-L2-06-02", title: "Second" }),
    ],
  });
  const ids = merged.tree.l1s[0].l2s.map((l2) => l2.id);
  assert.equal(new Set(ids).size, 2, `duplicate ids: ${ids.join(", ")}`);
});

test("repairMojibake undoes UTF-8 read as Latin-1 or Windows-1252", () => {
  const good = "Ensure ≥ 85% of deliverables … maintain ≤ 10% — “first review”";
  const bytes = new TextEncoder().encode(good);
  const latin1 = String.fromCharCode(...bytes);
  assert.equal(repairMojibake(latin1), good);
  const cp1252 = new TextDecoder("windows-1252").decode(bytes);
  assert.equal(repairMojibake(cp1252), good);
});

test("repairMojibake leaves clean text alone", () => {
  for (const s of ["café résumé", "Ensure ≥ 85%", "plain ascii", "Âge"]) {
    assert.equal(repairMojibake(s), s);
  }
});

test("parseImportFile reads a BOM-less UTF-8 CSV without garbling symbols", async () => {
  const csv =
    'ZOHO_LINK_ID,L1,KRA Description,Weightage\n' +
    '1,Quality,"Ensure ≥ 85% on first review and ≤ 10% defects",20\n';
  const file = new File([new TextEncoder().encode(csv)], "l1.csv");
  const res = await parseImportFile(file, { forceType: "l1" });
  assert.equal(res.rows[0].rubric, "Ensure ≥ 85% on first review and ≤ 10% defects");
});

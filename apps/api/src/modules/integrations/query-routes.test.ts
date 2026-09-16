/**
 * Regression coverage for `findFieldSource` — a real production bug where
 * every cadenced query-backed field resolved to "field_not_auto_filled".
 *
 * Root cause: the lookup filtered `composed.periods[]` by `period.key`
 * against the caller's `periodKey`, but those are different namespaces
 * (an author-chosen slug like "w1" vs. a calendar-derived storage key like
 * "2026-Q3") that never coincide — so whenever a periodKey was present
 * (i.e. on every cadenced tracker) the search list was empty and the
 * widget-level `spec.fields` was never consulted at all.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { findFieldSource } from "./query-routes.js";

const AUTO_SOURCE = {
  provider: "github",
  query: "repo_file_exists",
  params: { repo: "espace/devhub", path: "AGENTS.md" },
  extract: "exists",
};

test("findFieldSource resolves a widget-level field on a cadenced spec", () => {
  const spec = {
    fields: [{ id: "readme", label: "README exists", kind: "checkbox", source: AUTO_SOURCE }],
    composed: { cadence: "quarterly" },
  };
  assert.deepEqual(findFieldSource(spec, "readme"), AUTO_SOURCE);
});

test("findFieldSource resolves even when the spec carries authored periods", () => {
  const spec = {
    fields: [{ id: "readme", label: "README exists", kind: "checkbox", source: AUTO_SOURCE }],
    composed: {
      cadence: "monthly",
      periods: [
        { key: "m1", label: "Month 1" },
        { key: "m2", label: "Month 2" },
      ],
    },
  };
  assert.deepEqual(findFieldSource(spec, "readme"), AUTO_SOURCE);
});

test("findFieldSource returns null for a manual (non-source) field", () => {
  const spec = {
    fields: [{ id: "note", label: "Note", kind: "text" }],
  };
  assert.equal(findFieldSource(spec, "note"), null);
});

test("findFieldSource returns null for an unknown field id", () => {
  const spec = {
    fields: [{ id: "readme", label: "README exists", kind: "checkbox", source: AUTO_SOURCE }],
  };
  assert.equal(findFieldSource(spec, "missing"), null);
});

/**
 * The SECOND shape of the same bug: a field the spec defines only on a
 * period, a nested cadence, or the management half is nowhere in
 * `spec.fields`, so an id-only lookup can never find it — every such field
 * answered "isn't filled from a connected tool" no matter what it read.
 *
 * The fix is an address rather than a wider search: field ids are only
 * unique within one field list (`validateField` hands out `f1` per list), so
 * searching the tree by id would sooner or later run week 1's query under
 * week 9's label.
 */

const NESTED_SOURCE = {
  provider: "github",
  query: "repo_file_exists",
  params: { repo: "espace/devhub", path: "AGENTS.md" },
  extract: "exists",
};

const PERIOD_SOURCE = {
  provider: "github",
  query: "repo_file_exists",
  params: { repo: "espace/devhub", path: "docs/charter.md" },
  extract: "exists",
};

const periodSpec = {
  fields: [{ id: "note", label: "Notes", kind: "text" }],
  composed: {
    cadence: "monthly",
    periods: [
      { key: "m1", label: "Month 1" },
      {
        key: "m2",
        label: "Month 2",
        fields: [{ id: "charter", label: "Charter shipped", kind: "checkbox", source: PERIOD_SOURCE }],
      },
    ],
  },
};

test("findFieldSource resolves a field defined only on a period", () => {
  assert.deepEqual(findFieldSource(periodSpec, "charter", [1]), PERIOD_SOURCE);
});

test("findFieldSource does not leak a period's field into another window", () => {
  assert.equal(findFieldSource(periodSpec, "charter", [0]), null);
});

test("findFieldSource resolves a field inside a nested cadence", () => {
  const spec = {
    fields: [{ id: "note", label: "Notes", kind: "text" }],
    composed: {
      cadence: "quarterly",
      periods: [
        {
          key: "q1",
          label: "Q1",
          nested: {
            cadence: "weekly",
            fields: [{ id: "agents", label: "AGENTS.md exists", kind: "checkbox", source: NESTED_SOURCE }],
          },
        },
      ],
    },
  };
  assert.deepEqual(findFieldSource(spec, "agents", [0, 3]), NESTED_SOURCE);
  // Nothing nests under the top-level window itself.
  assert.equal(findFieldSource(spec, "agents", [0]), null);
});

test("findFieldSource resolves a field on the management half", () => {
  const spec = {
    fields: [{ id: "note", label: "Notes", kind: "text" }],
    composed: {
      cadence: "quarterly",
      management: {
        cadence: "monthly",
        fields: [{ id: "reviews", label: "Reviews done", kind: "checkbox", source: PERIOD_SOURCE }],
      },
    },
  };
  assert.deepEqual(findFieldSource(spec, "reviews", ["management", 0]), PERIOD_SOURCE);
});

test("findFieldSource ignores a path the spec cannot honour", () => {
  assert.equal(findFieldSource(periodSpec, "charter", [1, 0]), null);
  assert.equal(findFieldSource(periodSpec, "charter", ["management", 0]), null);
});

test("findFieldSource still answers a pathless (old client) request", () => {
  const spec = {
    fields: [{ id: "readme", label: "README exists", kind: "checkbox", source: AUTO_SOURCE }],
    composed: { cadence: "monthly", periods: [{ key: "m1", label: "Month 1" }] },
  };
  assert.deepEqual(findFieldSource(spec, "readme"), AUTO_SOURCE);
});

test("a widget-level field resolves through a period path that does not redefine it", () => {
  const spec = {
    fields: [{ id: "readme", label: "README exists", kind: "checkbox", source: AUTO_SOURCE }],
    composed: {
      cadence: "monthly",
      periods: [{ key: "m1", label: "Month 1" }, { key: "m2", label: "Month 2" }],
    },
  };
  assert.deepEqual(findFieldSource(spec, "readme", [1]), AUTO_SOURCE);
});

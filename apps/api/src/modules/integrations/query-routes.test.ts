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

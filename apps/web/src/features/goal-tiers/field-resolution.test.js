import test from "node:test";
import assert from "node:assert/strict";

import { fieldsForPeriodKey } from "./composed-field-resolution.js";

/**
 * Regression cover for a real bug: nested-cadence entries are stored under a
 * compound periodKey ("2026-Q1::2026-W3"), but the AI grader used to always
 * read every period's `values` against the TOP-LEVEL `spec.fields` — which
 * for a nested entry meant looking up field ids that don't exist on that
 * record, so every field came back blank and the entry's real content was
 * invisible to the grader.
 */

const TOP_FIELD = { id: "rating", kind: "scale", label: "Quarter rating" };
const NESTED_FIELD = { id: "shipped", kind: "text", label: "What shipped" };
const NESTED_FIELD_2 = { id: "blockers", kind: "text", label: "Blockers" };

function nestedSpec() {
  return {
    fields: [TOP_FIELD],
    composed: {
      cadence: "quarterly",
      cycleStart: "2026-01-01",
      cycleEnd: "2026-12-31",
      periods: [
        {
          key: "q1",
          label: "Q1",
          fields: [TOP_FIELD],
          nested: {
            cadence: "weekly",
            fields: [NESTED_FIELD],
            periods: [
              { key: "w1", label: "Week 1" },
              { key: "w2", label: "Week 2", fields: [NESTED_FIELD_2] },
            ],
          },
        },
        { key: "q2", label: "Q2" }, // no nested block
      ],
    },
  };
}

test("a flat (non-compound) periodKey resolves to the top-level fields", () => {
  const spec = nestedSpec();
  const fields = fieldsForPeriodKey(spec, "2026-Q1");
  assert.deepEqual(fields, [TOP_FIELD]);
});

test("a nested entry resolves to the NESTED level's fields, not the top level's", () => {
  const spec = nestedSpec();
  // Q1 spans Jan 1 - Mar 31; week 1 of the nested weekly cadence starts Jan 1.
  const fields = fieldsForPeriodKey(spec, "2026-Q1::2026-W1");
  assert.deepEqual(fields, [NESTED_FIELD], "falls back to nested.fields — week 1 has no override");
});

test("a nested period's own field override wins over the nested block's default", () => {
  const spec = nestedSpec();
  const fields = fieldsForPeriodKey(spec, "2026-Q1::2026-W2");
  assert.deepEqual(fields, [NESTED_FIELD_2]);
});

test("__single__ and empty keys resolve to the top-level fields", () => {
  const spec = nestedSpec();
  assert.deepEqual(fieldsForPeriodKey(spec, "__single__"), [TOP_FIELD]);
  assert.deepEqual(fieldsForPeriodKey(spec, null), [TOP_FIELD]);
});

test("an unresolvable segment falls back to whatever was resolved so far, never guesses", () => {
  const spec = nestedSpec();
  // Q2 has no nested block at all — a "::something" suffix can't be located.
  const fields = fieldsForPeriodKey(spec, "2026-Q2::2026-W1");
  assert.deepEqual(fields, [TOP_FIELD], "Q2 authored no fields override, so falls back to spec.fields");
});

test("a spec with no composed cadence at all falls back to top-level fields", () => {
  const fields = fieldsForPeriodKey({ fields: [TOP_FIELD] }, "2026-Q1::2026-W1");
  assert.deepEqual(fields, [TOP_FIELD]);
});

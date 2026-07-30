import test from "node:test";
import assert from "node:assert/strict";

import { resolvePeriodContent, resolveNestedPeriodContent } from "./types.js";
import { buildSpec } from "./validator.js";

/**
 * Cover for COMPOSED's per-period content (`composed.periods[]`).
 *
 * The feature exists because a plan whose every period asks for something
 * DIFFERENT — a 13-week rollout wanting a team charter in week 1 and a spec
 * template in week 8 — otherwise collapses into one generic "this period's
 * status", and months later nobody can reconstruct what "Done" referred to.
 *
 * Two properties matter more than the feature itself, and most of the tests
 * below are about them:
 *
 *   1. BACKWARD COMPATIBILITY. Every COMPOSED spec written before this existed
 *      has no `periods` key and must behave byte-identically. This is enforced
 *      rather than assumed because those specs are live in Mongo.
 *   2. POSITIONAL ALIGNMENT. Period i annotates cycle window i, so per-period
 *      content rides the existing window machinery (compliance, owed state,
 *      the stepper) instead of inventing a parallel key space that can drift
 *      out of step with the calendar.
 */

const FIELD = { id: "notes", kind: "text", label: "What did you do?" };

function composedSpec(extra = {}) {
  return buildSpec({
    goalId: "g1",
    title: "Custom tracker",
    kind: "manual",
    widget: "COMPOSED",
    reasoning: "test",
    fields: [FIELD],
    ...extra,
  });
}

// ─── backward compatibility ──────────────────────────────────────────

test("a COMPOSED spec with no periods validates and carries none", () => {
  const built = composedSpec({ composed: { cadence: "weekly", prompt: "Log it" } });
  assert.ok(built.ok, JSON.stringify(built.errors));
  assert.equal(built.spec.composed.cadence, "weekly");
  assert.equal(built.spec.composed.periods, undefined, "no periods key added");
});

test("resolving against a spec with no periods returns the flat content", () => {
  const { spec } = composedSpec({ composed: { cadence: "weekly", prompt: "Log it" } });
  for (const i of [0, 1, 12]) {
    const r = resolvePeriodContent(spec, i);
    assert.equal(r.authored, false);
    assert.equal(r.prompt, "Log it");
    assert.equal(r.label, null);
    assert.deepEqual(r.fields, spec.fields);
  }
});

// ─── authored periods ────────────────────────────────────────────────

const THIRTEEN_WEEK = {
  cadence: "weekly",
  prompt: "Log this week's progress",
  periods: [
    { key: "w1", label: "Week 1 — Team charter", prompt: "Publish the charter", dueAt: "2026-08-07" },
    {
      key: "w2",
      label: "Week 2 — Norms doc",
      fields: [{ id: "link", kind: "link", label: "Norms doc URL" }],
    },
  ],
};

test("periods validate and round-trip through buildSpec", () => {
  const built = composedSpec({ composed: THIRTEEN_WEEK });
  assert.ok(built.ok, JSON.stringify(built.errors));
  assert.equal(built.spec.composed.periods.length, 2);
  assert.equal(built.spec.composed.periods[0].label, "Week 1 — Team charter");
  assert.equal(built.spec.composed.periods[0].dueAt, "2026-08-07");
});

test("a period overrides only what it specifies", () => {
  const { spec } = composedSpec({ composed: THIRTEEN_WEEK });

  // Period 0 sets a prompt but no fields → its prompt wins, base fields stay.
  const p0 = resolvePeriodContent(spec, 0);
  assert.equal(p0.authored, true);
  assert.equal(p0.label, "Week 1 — Team charter");
  assert.equal(p0.prompt, "Publish the charter");
  assert.equal(p0.dueAt, "2026-08-07");
  assert.deepEqual(p0.fields, spec.fields, "no field override → base fields");

  // Period 1 sets fields but no prompt → its fields win, base prompt stays.
  const p1 = resolvePeriodContent(spec, 1);
  assert.equal(p1.label, "Week 2 — Norms doc");
  assert.equal(p1.prompt, "Log this week's progress", "inherits the base prompt");
  assert.equal(p1.fields[0].id, "link");
});

test("a window past the end of the list falls back instead of rendering nothing", () => {
  // A 2-period plan on a 13-window cycle: weeks 3-13 must still be fillable.
  const { spec } = composedSpec({ composed: THIRTEEN_WEEK });
  const r = resolvePeriodContent(spec, 7);
  assert.equal(r.authored, false);
  assert.deepEqual(r.fields, spec.fields);
  assert.equal(r.prompt, "Log this week's progress");
});

test("out-of-range and non-integer indexes fall back rather than throw", () => {
  const { spec } = composedSpec({ composed: THIRTEEN_WEEK });
  for (const i of [-1, 1.5, NaN, undefined, null]) {
    const r = resolvePeriodContent(spec, i);
    assert.equal(r.authored, false, `index ${String(i)} must fall back`);
  }
});

// ─── validation rules ────────────────────────────────────────────────

test("periods without a cadence are rejected — there are no windows to annotate", () => {
  const built = composedSpec({
    composed: { prompt: "Log it", periods: [{ key: "w1", label: "Week 1" }] },
  });
  assert.equal(built.ok, false);
  assert.ok(
    built.errors.some((e) => e.includes("composed.periods")),
    JSON.stringify(built.errors),
  );
});

test("a period without a label is rejected", () => {
  const built = composedSpec({
    composed: { cadence: "weekly", periods: [{ key: "w1" }] },
  });
  assert.equal(built.ok, false);
  assert.ok(built.errors.some((e) => e.includes("label")));
});

test("duplicate period keys are rejected", () => {
  const built = composedSpec({
    composed: {
      cadence: "weekly",
      periods: [
        { key: "w1", label: "Week 1" },
        { key: "w1", label: "Week 1 again" },
      ],
    },
  });
  assert.equal(built.ok, false);
  assert.ok(built.errors.some((e) => e.includes("duplicate")));
});

// ─── composed.cycleStart / cycleEnd ───────────────────────────────────

test("a valid cycleStart/cycleEnd pair round-trips", () => {
  const built = composedSpec({
    composed: { cadence: "weekly", cycleStart: "2026-09-07", cycleEnd: "2026-11-29" },
  });
  assert.ok(built.ok, JSON.stringify(built.errors));
  assert.equal(built.spec.composed.cycleStart, "2026-09-07");
  assert.equal(built.spec.composed.cycleEnd, "2026-11-29");
});

test("cycleStart/cycleEnd is dropped (not fatal) when only one side is present", () => {
  const built = composedSpec({
    composed: { cadence: "weekly", cycleStart: "2026-09-07" },
  });
  assert.ok(built.ok, JSON.stringify(built.errors));
  assert.equal(built.spec.composed.cycleStart, undefined);
});

test("cycleStart/cycleEnd is dropped when malformed or inverted", () => {
  for (const composed of [
    { cadence: "weekly", cycleStart: "not-a-date", cycleEnd: "2026-11-29" },
    { cadence: "weekly", cycleStart: "2026-11-29", cycleEnd: "2026-09-07" },
    { cadence: "weekly", cycleStart: "09/07/2026", cycleEnd: "11/29/2026" },
  ]) {
    const built = composedSpec({ composed });
    assert.ok(built.ok, JSON.stringify(built.errors));
    assert.equal(built.spec.composed.cycleStart, undefined);
    assert.equal(built.spec.composed.cycleEnd, undefined);
  }
});

test("a malformed dueAt is dropped, not fatal — content matters more than styling", () => {
  const built = composedSpec({
    composed: {
      cadence: "weekly",
      periods: [{ key: "w1", label: "Week 1", dueAt: "next Tuesday" }],
    },
  });
  assert.ok(built.ok, JSON.stringify(built.errors));
  assert.equal(built.spec.composed.periods[0].dueAt, undefined);
  assert.equal(built.spec.composed.periods[0].label, "Week 1");
});

test("period fields are validated like any other composed fields", () => {
  const built = composedSpec({
    composed: {
      cadence: "weekly",
      periods: [
        { key: "w1", label: "Week 1", fields: [{ id: "x", kind: "nonsense", label: "Bad" }] },
      ],
    },
  });
  assert.equal(built.ok, false);
  assert.ok(built.errors.some((e) => e.includes("kind")));
});

test("a select field inside a period still requires options", () => {
  const built = composedSpec({
    composed: {
      cadence: "weekly",
      periods: [
        { key: "w1", label: "Week 1", fields: [{ id: "s", kind: "select", label: "Status" }] },
      ],
    },
  });
  assert.equal(built.ok, false);
  assert.ok(built.errors.some((e) => e.includes("options")));
});

// ─── nested cadences (composed.periods[].nested) ──────────────────────
//
// A quarter's period can itself frame a whole second cadence — weeks living
// inside that quarter, each with their own form. Recursive: a nested block
// can nest again, arbitrarily deep (gated only by a safety ceiling).

const NESTED_FIELD = { id: "shipped", kind: "checkbox", label: "Deliverable shipped" };

test("a period's nested cadence round-trips through buildSpec", () => {
  const built = composedSpec({
    composed: {
      cadence: "quarterly",
      cycleStart: "2026-01-01",
      cycleEnd: "2026-12-31",
      periods: [
        {
          key: "q1",
          label: "Q1",
          fields: [{ id: "quarter_rating", kind: "scale", label: "Overall quarter rating" }],
          nested: {
            cadence: "weekly",
            cycleStart: "2026-01-01",
            cycleEnd: "2026-03-29",
            fields: [NESTED_FIELD],
            periods: [
              { key: "w1", label: "Week 1 — Kickoff" },
              { key: "w2", label: "Week 2 — Design" },
            ],
          },
        },
      ],
    },
  });
  assert.ok(built.ok, JSON.stringify(built.errors));
  const q1 = built.spec.composed.periods[0];
  assert.equal(q1.fields[0].id, "quarter_rating");
  assert.equal(q1.nested.cadence, "weekly");
  assert.equal(q1.nested.periods.length, 2);
  assert.equal(q1.nested.periods[1].label, "Week 2 — Design");
});

test("resolveNestedPeriodContent resolves a window inside a nested block, falling back to composed.fields", () => {
  const nested = {
    cadence: "weekly",
    fields: [NESTED_FIELD],
    periods: [
      { key: "w1", label: "Week 1 — Kickoff", fields: [{ id: "kickoff_notes", kind: "text", label: "Notes" }] },
      { key: "w2", label: "Week 2 — Design" }, // no field override → falls back to nested.fields
    ],
  };
  const w1 = resolveNestedPeriodContent(nested, 0);
  assert.equal(w1.authored, true);
  assert.equal(w1.fields[0].id, "kickoff_notes");

  const w2 = resolveNestedPeriodContent(nested, 1);
  assert.equal(w2.authored, true);
  assert.equal(w2.fields[0].id, "shipped", "falls back to nested.fields, not the outer spec's fields");
});

test("resolvePeriodContent exposes a period's nested block for the caller to recurse into", () => {
  const built = composedSpec({
    composed: {
      cadence: "quarterly",
      periods: [
        {
          key: "q1",
          label: "Q1",
          nested: { cadence: "weekly", fields: [NESTED_FIELD], periods: [{ key: "w1", label: "Week 1" }] },
        },
        { key: "q2", label: "Q2" }, // no nested block
      ],
    },
  });
  assert.ok(built.ok, JSON.stringify(built.errors));
  const q1 = resolvePeriodContent(built.spec, 0);
  assert.ok(q1.nested, "Q1 exposes its nested weekly cadence");
  assert.equal(q1.nested.cadence, "weekly");

  const q2 = resolvePeriodContent(built.spec, 1);
  assert.equal(q2.nested, null, "Q2 authored no nested cadence");
});

test("nesting recurses arbitrarily deep (quarter > month > week)", () => {
  const built = composedSpec({
    composed: {
      cadence: "quarterly",
      periods: [
        {
          key: "q1",
          label: "Q1",
          nested: {
            cadence: "monthly",
            fields: [{ id: "month_notes", kind: "text", label: "Month notes" }],
            periods: [
              {
                key: "m1",
                label: "Month 1",
                nested: {
                  cadence: "weekly",
                  fields: [NESTED_FIELD],
                  periods: [{ key: "w1", label: "Week 1" }],
                },
              },
            ],
          },
        },
      ],
    },
  });
  assert.ok(built.ok, JSON.stringify(built.errors));
  const month = built.spec.composed.periods[0].nested.periods[0];
  assert.equal(month.nested.cadence, "weekly");
  assert.equal(month.nested.periods[0].label, "Week 1");
});

test("nesting past the safety ceiling is rejected, not silently truncated", () => {
  // Build 9 levels deep (ceiling is 8) so the deepest level itself is rejected.
  let deepest = { cadence: "daily", periods: [{ key: "d1", label: "Day 1" }] };
  for (let i = 0; i < 8; i += 1) {
    deepest = { cadence: "weekly", periods: [{ key: "w1", label: `Level ${i}`, nested: deepest }] };
  }
  const built = composedSpec({ composed: deepest });
  assert.equal(built.ok, false);
  assert.ok(built.errors.some((e) => e.includes("nesting depth")));
});

test("composed.fields on a NESTED block must be non-empty when present", () => {
  const built = composedSpec({
    composed: {
      cadence: "quarterly",
      periods: [
        {
          key: "q1",
          label: "Q1",
          nested: { cadence: "weekly", fields: [], periods: [{ key: "w1", label: "Week 1" }] },
        },
      ],
    },
  });
  assert.equal(built.ok, false);
  assert.ok(built.errors.some((e) => e.includes("composed.fields")));
});

test("a top-level composed.fields is accepted but plays no role — spec.fields already owns that job", () => {
  // Not an error, just inert: validateComposed only stores `fields` for depth > 0.
  const built = composedSpec({
    composed: { cadence: "weekly", fields: [NESTED_FIELD], periods: [{ key: "w1", label: "Week 1" }] },
  });
  assert.ok(built.ok, JSON.stringify(built.errors));
  assert.equal(built.spec.composed.fields, undefined);
});

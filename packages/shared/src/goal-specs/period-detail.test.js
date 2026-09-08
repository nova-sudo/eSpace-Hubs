import test from "node:test";
import assert from "node:assert/strict";

import { resolvePeriodContent, resolveNestedPeriodContent } from "./types.js";
import { buildSpec } from "./validator.js";

/**
 * Cover for a period's narrative content — `detail` (focus / activities /
 * deliverables) and `notes` (risks and their mitigations).
 *
 * The gap this closes: a period could hold `label`, `dueAt`, `prompt` and its
 * fields, so "Week 1 — AI orientation" was the ENTIRE surviving record of a
 * week whose source document listed a focus, three activities and four named
 * artifacts, plus a risks table for the plan as a whole. Everything else was
 * dropped on the floor by the validator, silently.
 *
 * Two properties carry most of these tests:
 *
 *   1. IT CANNOT BREAK A TRACKER. Detail and notes are display-only — they
 *      never reach the grader, and no malformed value may fail a spec that is
 *      otherwise valid. Over-long content truncates; junk is skipped.
 *   2. BACKWARD COMPATIBILITY. A spec written before this existed carries
 *      neither key and resolves exactly as it always did.
 */

const FIELD = { id: "notes", kind: "text", label: "What did you do?" };

function composedSpec(extra = {}) {
  return buildSpec({
    goalId: "g1",
    title: "Onboarding plan",
    kind: "manual",
    widget: "COMPOSED",
    reasoning: "test",
    fields: [FIELD],
    ...extra,
  });
}

const WEEK_1 = {
  key: "w1",
  label: "Week 1 — AI orientation",
  detail: {
    focus: "AI orientation",
    activities: ["Claude 101", "AI Fluency Framework", "Team kickoff session"],
    deliverables: [
      {
        label: "Team charter",
        format: "AGENTS.md + project.md in the repo root",
        criteria: "Lists the agreed norms and who signed off",
      },
      { label: "Shared memory-bank skeleton" },
    ],
  },
};

// ─── the happy path ──────────────────────────────────────────────────

test("a period carries focus, activities and deliverables through to the window", () => {
  const built = composedSpec({ composed: { cadence: "weekly", periods: [WEEK_1] } });
  assert.ok(built.ok, JSON.stringify(built.errors));

  const w0 = resolvePeriodContent(built.spec, 0);
  assert.equal(w0.detail.focus, "AI orientation");
  assert.deepEqual(w0.detail.activities, [
    "Claude 101",
    "AI Fluency Framework",
    "Team kickoff session",
  ]);
  assert.equal(w0.detail.deliverables.length, 2);
  assert.equal(w0.detail.deliverables[0].format, "AGENTS.md + project.md in the repo root");
  // A deliverable is allowed to be just a name — format/criteria are the
  // document's "how it must look", and not every document states one.
  assert.equal(w0.detail.deliverables[1].criteria, undefined);
});

test("a plain string is accepted as the focus, and as a deliverable label", () => {
  const built = composedSpec({
    composed: {
      cadence: "weekly",
      periods: [
        { key: "w1", label: "Week 1", detail: { focus: "AI limits and ethics" } },
        { key: "w2", label: "Week 2", detail: "Claude Code in practice" },
        {
          key: "w3",
          label: "Week 3",
          detail: { deliverables: ["Phase 1 retrospective notes"] },
        },
      ],
    },
  });
  assert.ok(built.ok, JSON.stringify(built.errors));
  assert.equal(resolvePeriodContent(built.spec, 1).detail.focus, "Claude Code in practice");
  assert.equal(
    resolvePeriodContent(built.spec, 2).detail.deliverables[0].label,
    "Phase 1 retrospective notes",
  );
});

test("a risk keeps its likelihood and mitigation; plan-level risks live on the spec", () => {
  const built = composedSpec({
    composed: {
      cadence: "weekly",
      notes: [
        {
          kind: "risk",
          label: "SDD creates too much overhead for small tasks",
          likelihood: "high",
          mitigation: "Scale the ceremony to the size of the task",
        },
      ],
      periods: [{ key: "w1", label: "Week 1", notes: [{ label: "Pair with the kickoff" }] }],
    },
  });
  assert.ok(built.ok, JSON.stringify(built.errors));

  const planNotes = built.spec.composed.notes;
  assert.equal(planNotes.length, 1);
  assert.equal(planNotes[0].kind, "risk");
  assert.equal(planNotes[0].likelihood, "high");
  assert.equal(planNotes[0].mitigation, "Scale the ceremony to the size of the task");

  // A period's own notes resolve with the window; the PLAN's notes do not
  // leak into every window (they render once, at widget level).
  const w0 = resolvePeriodContent(built.spec, 0);
  assert.equal(w0.notes.length, 1);
  assert.equal(w0.notes[0].kind, "note", "an unlabelled note is a note, not a risk");
});

// ─── it cannot break a tracker ───────────────────────────────────────

test("junk detail and notes are skipped, never fatal", () => {
  const built = composedSpec({
    composed: {
      cadence: "weekly",
      notes: ["a bare string note", null, 42, { body: "no label" }],
      periods: [
        {
          key: "w1",
          label: "Week 1",
          detail: { focus: "   ", activities: ["ok", "", null, 7], deliverables: [null, {}] },
          notes: "not an array",
        },
      ],
    },
  });
  assert.ok(built.ok, JSON.stringify(built.errors));

  const w0 = resolvePeriodContent(built.spec, 0);
  // Blank focus and unusable deliverables drop out; the one good activity stays.
  assert.deepEqual(w0.detail, { activities: ["ok"] });
  assert.deepEqual(w0.notes, []);
  // The bare string became a note; the label-less object did not.
  assert.equal(built.spec.composed.notes.length, 1);
  assert.equal(built.spec.composed.notes[0].label, "a bare string note");
});

test("an empty detail block is dropped rather than stored as {}", () => {
  const built = composedSpec({
    composed: { cadence: "weekly", periods: [{ key: "w1", label: "Week 1", detail: {} }] },
  });
  assert.ok(built.ok, JSON.stringify(built.errors));
  assert.equal(built.spec.composed.periods[0].detail, undefined);
});

test("over-long content truncates instead of bouncing the whole plan", () => {
  const built = composedSpec({
    composed: {
      cadence: "weekly",
      periods: [
        {
          key: "w1",
          label: "Week 1",
          detail: {
            focus: "x".repeat(1000),
            activities: Array.from({ length: 50 }, (_, i) => "activity " + i),
            deliverables: Array.from({ length: 50 }, (_, i) => "deliverable " + i),
          },
          notes: Array.from({ length: 50 }, (_, i) => "note " + i),
        },
      ],
    },
  });
  assert.ok(built.ok, JSON.stringify(built.errors));
  const d = built.spec.composed.periods[0].detail;
  assert.equal(d.focus.length, 240);
  assert.equal(d.activities.length, 12);
  assert.equal(d.deliverables.length, 8);
  assert.equal(built.spec.composed.periods[0].notes.length, 12);
});

test("an out-of-vocabulary likelihood is dropped, keeping the risk itself", () => {
  const built = composedSpec({
    composed: {
      cadence: "weekly",
      notes: [{ kind: "risk", label: "Model drift", likelihood: "catastrophic" }],
      periods: [{ key: "w1", label: "Week 1" }],
    },
  });
  assert.ok(built.ok, JSON.stringify(built.errors));
  const note = built.spec.composed.notes[0];
  assert.equal(note.kind, "risk");
  assert.equal(note.likelihood, undefined);
});

// ─── backward compatibility ──────────────────────────────────────────

test("a period with no detail resolves to null detail and no notes", () => {
  const built = composedSpec({
    composed: { cadence: "weekly", periods: [{ key: "w1", label: "Week 1" }] },
  });
  assert.ok(built.ok, JSON.stringify(built.errors));
  assert.equal(built.spec.composed.periods[0].detail, undefined);
  assert.equal(built.spec.composed.periods[0].notes, undefined);

  const w0 = resolvePeriodContent(built.spec, 0);
  assert.equal(w0.detail, null);
  assert.deepEqual(w0.notes, []);
});

test("an unauthored window past the end of the list carries no detail", () => {
  const built = composedSpec({
    composed: { cadence: "weekly", periods: [WEEK_1] },
  });
  const w9 = resolvePeriodContent(built.spec, 9);
  assert.equal(w9.authored, false);
  assert.equal(w9.detail, null, "a neighbouring week's focus is worse than none");
  assert.deepEqual(w9.notes, []);
});

test("detail survives inside a nested cadence too", () => {
  const built = composedSpec({
    composed: {
      cadence: "quarterly",
      periods: [
        {
          key: "q3",
          label: "Q3",
          nested: {
            cadence: "weekly",
            fields: [FIELD],
            periods: [WEEK_1],
          },
        },
      ],
    },
  });
  assert.ok(built.ok, JSON.stringify(built.errors));
  const q3 = resolvePeriodContent(built.spec, 0);
  const week1 = resolveNestedPeriodContent(q3.nested, 0);
  assert.equal(week1.detail.focus, "AI orientation");
  assert.equal(week1.detail.deliverables[0].label, "Team charter");
});

// ─── the management half ─────────────────────────────────────────────

/**
 * A development plan for someone who leads people describes two jobs. Kept in
 * one list of periods, nobody can tell which half is which — so the second one
 * gets its own composed block, with its own cadence.
 */

test("a management block validates as a composed block of its own", () => {
  const built = composedSpec({
    composed: {
      cadence: "weekly",
      periods: [WEEK_1],
      management: {
        cadence: "monthly",
        prompt: "What did you do for the team this month?",
        fields: [{ id: "ones", kind: "counter", label: "1:1s held" }],
        periods: [
          {
            key: "m1",
            label: "Month 1 — onboard the new hire",
            detail: { deliverables: [{ label: "Onboarding buddy assigned" }] },
          },
        ],
      },
    },
  });
  assert.ok(built.ok, JSON.stringify(built.errors));
  const mgmt = built.spec.composed.management;
  assert.equal(mgmt.cadence, "monthly");
  assert.equal(mgmt.periods[0].detail.deliverables[0].label, "Onboarding buddy assigned");
  // Nested blocks keep their own default fields — the top level uses
  // spec.fields for that job, but a management block has no spec of its own.
  assert.equal(mgmt.fields[0].label, "1:1s held");
});

test("a management block cannot contain another one", () => {
  const built = composedSpec({
    composed: {
      cadence: "weekly",
      periods: [{ key: "w1", label: "Week 1" }],
      management: {
        cadence: "monthly",
        periods: [{ key: "m1", label: "Month 1" }],
        management: { cadence: "weekly", periods: [{ key: "x", label: "Nope" }] },
      },
    },
  });
  assert.ok(built.ok, JSON.stringify(built.errors));
  assert.equal(built.spec.composed.management.management, undefined);
});

test("a spec with no management block is untouched", () => {
  const built = composedSpec({
    composed: { cadence: "weekly", periods: [{ key: "w1", label: "Week 1" }] },
  });
  assert.ok(built.ok, JSON.stringify(built.errors));
  assert.equal(built.spec.composed.management, undefined);
});

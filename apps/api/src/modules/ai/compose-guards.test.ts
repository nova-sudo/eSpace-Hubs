import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanComposedBlock,
  cleanComposedPeriods,
  dropPeriodEchoFields,
  findUngradeableTiers,
} from "./controller.js";

/**
 * Regression cover for the two composed-tracker guards.
 *
 * Both exist because a real 13-week plan produced a tracker with:
 *   - a "Plan Week" select, duplicating the period stamp every record already
 *     carries (two answers to one question, free to drift apart), and
 *   - `roleModel = "All 13 weekly deliverables completed on time"` against
 *     fields that never recorded which deliverable belonged to which week —
 *     a top tier nothing could grade.
 *
 * The prompt asks for neither, so these are enforced server-side. Both guards
 * are deliberately conservative: dropping a real field or crying wolf on a
 * legitimate tier is worse than missing a case, so the tests below pin the
 * NEGATIVE cases as hard as the positive ones.
 */

const field = (label: string, kind = "select") => ({ id: "f", kind, label });

// ─── dropPeriodEchoFields ────────────────────────────────────────────

test("drops a bare period-echo field when the tracker has a cadence", () => {
  const { fields, dropped } = dropPeriodEchoFields(
    [field("Plan Week"), field("Blockers", "text")],
    "weekly",
  );
  assert.deepEqual(dropped, ["Plan Week"]);
  assert.equal(fields.length, 1);
  assert.equal(fields[0].label, "Blockers");
});

test("drops the other period-echo phrasings", () => {
  for (const label of [
    "Week",
    "Month number",
    "Which quarter",
    "Current sprint",
    "Period #",
    "the month",
  ]) {
    const { dropped } = dropPeriodEchoFields(
      [field(label), field("Notes", "text")],
      "monthly",
    );
    assert.deepEqual(dropped, [label], `expected "${label}" to be dropped`);
  }
});

test("keeps fields that merely MENTION a period", () => {
  // The whole risk of this guard is eating real data. These all carry meaning
  // beyond "which period is this".
  for (const label of [
    "Weekly Deliverable Status",
    "Week of biggest blocker",
    "Monthly revenue",
    "Sprint goal met",
    "Quarterly OKR score",
  ]) {
    const { fields, dropped } = dropPeriodEchoFields(
      [field(label), field("Notes", "text")],
      "weekly",
    );
    assert.deepEqual(dropped, [], `expected "${label}" to be KEPT`);
    assert.equal(fields.length, 2);
  }
});

test("leaves everything alone when the tracker has no cadence", () => {
  // With no cadence there's no period stamp, so "Week" may be the only thing
  // locating the record in time.
  const { fields, dropped } = dropPeriodEchoFields([field("Week")], undefined);
  assert.deepEqual(dropped, []);
  assert.equal(fields.length, 1);
});

test("never strips the tracker down to zero fields", () => {
  const { fields, dropped } = dropPeriodEchoFields([field("Week")], "weekly");
  assert.deepEqual(dropped, [], "a heuristic must not empty the tracker");
  assert.equal(fields.length, 1);
});

// ─── findUngradeableTiers ────────────────────────────────────────────

const STATUS_ONLY_FIELDS = [
  { id: "status", kind: "select", label: "Weekly Deliverable Status" },
  { id: "done", kind: "checkbox", label: "Courses completed" },
];

test("flags a whole-cycle tier when no authored periods pin down each period", () => {
  const notes = findUngradeableTiers({
    achieved: "Weekly deliverable completed.",
    roleModel: "All 13 weekly deliverables completed on time.",
  });
  assert.equal(notes.length, 1);
  assert.match(notes[0], /roleModel/);
  assert.match(notes[0], /can't be graded/);
});

test("flags the N-of-N phrasing too", () => {
  const notes = findUngradeableTiers({
    achieved: "6 of 6 monthly checkpoints delivered.",
  });
  assert.equal(notes.length, 1);
});

test("a generic free-text field does NOT buy a whole-cycle tier a pass", () => {
  // Regression guard for a real shipped tracker: fields were
  //   [checkbox "This month's milestone completed", text "Notes / blockers"]
  // against achieved = "All 6 monthly milestones checked off". An earlier
  // version of this guard exempted any text/link/date field on the theory it
  // might record WHICH item the period covered — so the notes box silently
  // waved the tier through. A free-text box records what the user felt like
  // typing, not which of six specific deliverables was due.
  const notes = findUngradeableTiers({
    achieved:
      "All 6 monthly milestones checked off and the framework published by Month 6.",
  });
  assert.equal(notes.length, 1, "a notes field must not exempt the tier");
});

test("stays quiet on ordinary per-period tiers", () => {
  const notes = findUngradeableTiers({
    notAchieved: "No deliverable logged this week.",
    achieved: "Deliverable completed and coverage >= 80%.",
    overAchieved: "Completed early with evidence linked.",
  });
  assert.deepEqual(notes, []);
});

test("handles a null tier set", () => {
  assert.deepEqual(findUngradeableTiers(null), []);
});

// ─── cleanComposedPeriods ────────────────────────────────────────────

test("cleans a per-period list, slugging keys and keeping order", () => {
  const out = cleanComposedPeriods([
    { key: "W 1", label: "Week 1 — Team charter", dueAt: "2026-08-07" },
    { key: "w2", label: "Week 2 — Norms doc", prompt: "Publish the doc" },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].key, "w-1");
  assert.equal(out[0].dueAt, "2026-08-07");
  assert.equal(out[1].prompt, "Publish the doc");
});

test("an unusable entry becomes a labelled placeholder, never a gap", () => {
  // Order IS meaning — entry i annotates window i. Dropping a bad entry would
  // silently shift every later period onto the wrong week.
  const out = cleanComposedPeriods([
    { label: "Week 1" },
    null,
    { label: "Week 3" },
  ]);
  assert.equal(out.length, 3, "positions preserved");
  assert.equal(out[1].label, "Period 2");
  assert.equal(out[2].label, "Week 3");
});

test("duplicate keys are disambiguated rather than dropped", () => {
  const out = cleanComposedPeriods([
    { key: "w", label: "One" },
    { key: "w", label: "Two" },
  ]);
  assert.equal(out.length, 2);
  assert.notEqual(out[0].key, out[1].key);
});

test("a bad dueAt is dropped but the period survives", () => {
  const out = cleanComposedPeriods([{ label: "Week 1", dueAt: "soon" }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].dueAt, undefined);
});

test("an empty field override is omitted so the period inherits base fields", () => {
  const out = cleanComposedPeriods([{ label: "Week 1", fields: [] }]);
  assert.equal(out[0].fields, undefined);
});

test("caps the list rather than accepting an unbounded plan", () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ label: `W${i}` }));
  assert.equal(cleanComposedPeriods(many).length, 53);
});

test("non-array input yields no periods", () => {
  assert.deepEqual(cleanComposedPeriods(undefined), []);
  assert.deepEqual(cleanComposedPeriods("weekly"), []);
});

test("authored periods stop the whole-cycle tier guard crying wolf", () => {
  // The trackers that FIXED the gap must not be accused of having it: a period
  // list IS the roster of what each period was for.
  const tiers = { roleModel: "All 13 weekly deliverables completed on time." };
  assert.equal(findUngradeableTiers(tiers).length, 1, "flat: flagged");
  assert.deepEqual(
    findUngradeableTiers(tiers, [{ key: "w1", label: "Week 1" }]),
    [],
    "with authored periods: not flagged",
  );
});

// ─── cleanComposedBlock: composed.cycleStart ──────────────────────────
//
// Regression cover for a real bug: a 13-week Q3-only plan rendered as a
// 53-week cycle because nothing ever anchored composed.cycleStart to the
// document's own dates — the AI wasn't asked for one. cleanComposedBlock is
// the gate between what the model returns and what lands on the spec.

test("carries a valid cycleStart when periods are present", () => {
  const out = cleanComposedBlock({
    cadence: "weekly",
    cycleStart: "2026-07-01",
    periods: [{ key: "w1", label: "Week 1" }],
  });
  assert.equal(out?.cycleStart, "2026-07-01");
});

test("drops a malformed cycleStart rather than failing the whole compose", () => {
  const out = cleanComposedBlock({
    cadence: "weekly",
    cycleStart: "not-a-date",
    periods: [{ key: "w1", label: "Week 1" }],
  });
  assert.equal(out?.cycleStart, undefined);
  assert.equal(out?.periods?.length, 1, "the periods themselves still survive");
});

test("drops cycleStart when there are no periods to anchor — it's meaningless alone", () => {
  const out = cleanComposedBlock({
    cadence: "weekly",
    cycleStart: "2026-07-01",
  });
  assert.equal(out?.cycleStart, undefined);
});

test("drops cycleStart when there's no cadence — periods themselves get rejected first", () => {
  const out = cleanComposedBlock({
    cycleStart: "2026-07-01",
    periods: [{ key: "w1", label: "Week 1" }],
  });
  assert.equal(out?.cycleStart, undefined);
  assert.equal(out?.periods, undefined);
});

test("omits cycleStart entirely when the model doesn't supply one", () => {
  const out = cleanComposedBlock({
    cadence: "weekly",
    periods: [{ key: "w1", label: "Week 1" }],
  });
  assert.equal(out?.cycleStart, undefined);
});

// ─── cleanComposedBlock / cleanComposedPeriods: nested cadences ───────
//
// A period's `nested` is a whole second composed block — mutually recursive
// cleaning with the same defensiveness as everything else here: untrusted
// model output, capped depth, silently dropped past the ceiling rather than
// failing the whole compose.

const NESTED_FIELD = { id: "shipped", kind: "text", label: "What shipped" };

test("a period's nested cadence is cleaned and carried through", () => {
  const out = cleanComposedBlock({
    cadence: "quarterly",
    periods: [
      {
        key: "q1",
        label: "Q1",
        fields: [field("Quarter rating", "scale")],
        nested: {
          cadence: "weekly",
          fields: [NESTED_FIELD],
          periods: [{ key: "w1", label: "Week 1" }, { key: "w2", label: "Week 2" }],
        },
      },
    ],
  });
  const q1 = out?.periods?.[0];
  assert.ok(q1?.fields?.length, "the outer period keeps its own rollup fields");
  assert.equal(q1?.nested?.cadence, "weekly");
  assert.equal(q1?.nested?.fields?.[0]?.id, "shipped");
  assert.equal(q1?.nested?.periods?.length, 2);
});

test("nested.fields is only read at depth > 0 — the top level ignores it", () => {
  const out = cleanComposedBlock({
    cadence: "weekly",
    fields: [NESTED_FIELD],
    periods: [{ key: "w1", label: "Week 1" }],
  });
  assert.equal(out?.fields, undefined);
});

test("a malformed nested block degrades to no nesting, not a failed compose", () => {
  const out = cleanComposedBlock({
    cadence: "quarterly",
    periods: [
      { key: "q1", label: "Q1", nested: { cadence: "not-a-real-cadence" } },
      { key: "q2", label: "Q2", nested: "not even an object" },
    ],
  });
  assert.equal(out?.periods?.[0]?.nested, undefined);
  assert.equal(out?.periods?.[1]?.nested, undefined);
  assert.equal(out?.periods?.length, 2, "both periods still survive");
});

test("nesting recurses arbitrarily deep through cleanComposedPeriods", () => {
  const out = cleanComposedBlock({
    cadence: "quarterly",
    periods: [
      {
        key: "q1",
        label: "Q1",
        nested: {
          cadence: "monthly",
          periods: [
            {
              key: "m1",
              label: "Month 1",
              nested: { cadence: "weekly", fields: [NESTED_FIELD], periods: [{ key: "w1", label: "Week 1" }] },
            },
          ],
        },
      },
    ],
  });
  const month = out?.periods?.[0]?.nested?.periods?.[0];
  assert.equal(month?.nested?.cadence, "weekly");
  assert.equal(month?.nested?.periods?.[0]?.label, "Week 1");
});

test("nesting past the depth ceiling is dropped, not carried through", () => {
  // 9 levels deep — one past the ceiling (8) — so the innermost is dropped.
  let deepest: Record<string, unknown> = { cadence: "daily", periods: [{ key: "d1", label: "Day 1" }] };
  for (let i = 0; i < 8; i += 1) {
    deepest = { cadence: "weekly", periods: [{ key: "w1", label: `Level ${i}`, nested: deepest }] };
  }
  const out = cleanComposedBlock(deepest);
  // Walk down until nested stops appearing — should happen before depth 9.
  let node: any = out;
  let depth = 0;
  while (node?.periods?.[0]?.nested) {
    node = node.periods[0].nested;
    depth += 1;
  }
  assert.ok(depth < 9, `expected nesting to stop before depth 9, got ${depth}`);
});

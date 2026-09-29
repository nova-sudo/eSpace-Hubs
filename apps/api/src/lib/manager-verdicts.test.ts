import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

import {
  acknowledgeManagerVerdict,
  buildVerdictHistory,
  defaultPeriodKey,
  isAcceptablePeriodKey,
  isNewDispute,
  isValidPeriodKey,
  periodOrdinal,
  latestPerGoalPerPeriod,
  listManagerVerdictHistory,
  recordManagerVerdict,
  shouldReplaceCurrent,
  verdictPeriodKey,
  type VerdictCollections,
} from "./manager-verdicts.js";
import { FakeCollection, asCollection } from "./fake-collection.test-support.js";

const orgId = new ObjectId();
const subjectUserId = new ObjectId();
const managerId = new ObjectId();
const goalId = "g-1";

function fakes(currentSeed: Record<string, unknown>[] = []) {
  const current = new FakeCollection(currentSeed);
  const events = new FakeCollection();
  const cols: VerdictCollections = {
    current: asCollection(current),
    events: asCollection(events),
  };
  return { current, events, cols };
}

function grade(
  cols: VerdictCollections,
  tier: "not_achieved" | "achieved" | "over_achieved" | "role_model",
  at: string,
  extra: { periodKey?: string; gradedByName?: string } = {},
) {
  return recordManagerVerdict(
    {
      orgId,
      subjectUserId,
      goalId,
      tier,
      note: `why ${tier}`,
      gradedBy: managerId,
      gradedByName: extra.gradedByName ?? "Ana",
      periodKey: extra.periodKey,
      now: new Date(at),
    },
    cols,
  );
}

// ─── pure helpers ────────────────────────────────────────────────────

test("period keys: a year, quarter, half or month", () => {
  for (const ok of ["2026", "2026-Q1", "2026-Q4", "2026-H2", "2026-03", "2026-12"]) {
    assert.equal(isValidPeriodKey(ok), true, ok);
  }
  for (const bad of [
    "26", "2026-", "2026-Q1-x", "2026 Q1", "", null, 2026,
    "2026-ZZZZ", "2026-Q5", "2026-H3", "2026-13", "2026-00", "2026-M03",
  ]) {
    assert.equal(isValidPeriodKey(bad), false, String(bad));
  }
});

test("a written period key must be within ±2 years of now", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  assert.equal(isAcceptablePeriodKey("2026", now), true);
  assert.equal(isAcceptablePeriodKey("2024-Q1", now), true);
  assert.equal(isAcceptablePeriodKey("2028-H2", now), true);
  assert.equal(isAcceptablePeriodKey("2099", now), false);
  assert.equal(isAcceptablePeriodKey("2023", now), false);
  assert.equal(isAcceptablePeriodKey("9999", now), false);
});

test("periods order by (year, then when their window ends)", () => {
  assert.ok(periodOrdinal("2026") > periodOrdinal("2026-Q1"));
  assert.ok(periodOrdinal("2026") >= periodOrdinal("2026-Q4"));
  assert.ok(periodOrdinal("2026-Q2") > periodOrdinal("2026-03"));
  assert.ok(periodOrdinal("2026-H1") === periodOrdinal("2026-Q2"));
  assert.ok(periodOrdinal("2027-01") > periodOrdinal("2026"));
});

test("default period is the UTC calendar year of the grade", () => {
  assert.equal(defaultPeriodKey(new Date("2026-12-31T23:59:59Z")), "2026");
  assert.equal(defaultPeriodKey(new Date("2027-01-01T00:00:00Z")), "2027");
});

test("a legacy row with no periodKey reads as the year it was graded", () => {
  assert.equal(
    verdictPeriodKey({ gradedAt: new Date("2025-06-01T00:00:00Z") }),
    "2025",
  );
  assert.equal(
    verdictPeriodKey({ periodKey: "2026-Q2", gradedAt: new Date("2025-06-01Z") }),
    "2026-Q2",
  );
});

test("an older period never replaces a later current grade", () => {
  assert.equal(shouldReplaceCurrent(null, "2025"), true);
  assert.equal(shouldReplaceCurrent("2026", "2026"), true);
  assert.equal(shouldReplaceCurrent("2025", "2026"), true);
  assert.equal(shouldReplaceCurrent("2026", "2025"), false);
  // Not string order: an annual grade after a quarter one updates the badge…
  assert.equal(shouldReplaceCurrent("2026-Q1", "2026"), true);
  // …and back-filling a quarter doesn't clobber the annual one.
  assert.equal(shouldReplaceCurrent("2026", "2026-Q1"), false);
});

test("a dispute is new only when it starts, or its note changes", () => {
  const seen = { disagree: false, note: "" };
  const d1 = { disagree: true, note: "late snapshot" };
  assert.equal(isNewDispute(null, d1), true);
  assert.equal(isNewDispute(seen, d1), true);
  assert.equal(isNewDispute(d1, { ...d1 }), false, "a repost stays silent");
  assert.equal(isNewDispute(d1, { disagree: true, note: "more detail" }), true);
  assert.equal(isNewDispute(d1, seen), false, "seen never notifies");
});

test("latestPerGoalPerPeriod keeps the newest grade per (goal, period)", () => {
  const rows = [
    { goalId: "a", periodKey: "2026", gradedAt: new Date("2026-01-01Z"), tier: "achieved" },
    { goalId: "a", periodKey: "2026", gradedAt: new Date("2026-03-01Z"), tier: "role_model" },
    { goalId: "a", periodKey: "2025", gradedAt: new Date("2025-03-01Z"), tier: "not_achieved" },
  ];
  const out = latestPerGoalPerPeriod(rows);
  assert.equal(out.size, 2);
  assert.equal(out.get("a\u00002026")?.tier, "role_model");
  assert.equal(out.get("a\u00002025")?.tier, "not_achieved");
});

test("history from a legacy current row alone is that one grade", () => {
  const history = buildVerdictHistory([], {
    _id: new ObjectId(),
    orgId,
    subjectUserId,
    goalId,
    tier: "achieved",
    note: "ok",
    gradedBy: managerId,
    gradedByName: "Ana",
    gradedAt: new Date("2025-09-03T10:00:00Z"),
    updatedAt: new Date("2025-09-03T10:00:00Z"),
  });
  assert.equal(history.length, 1);
  assert.equal(history[0].legacy, true);
  assert.equal(history[0].periodKey, "2025");
  assert.equal(history[0].previousTier, null);
});

// ─── append-only writes ──────────────────────────────────────────────

test("a re-grade in the same period supersedes, never overwrites", async () => {
  const { cols, events, current } = fakes();
  const first = await grade(cols, "over_achieved", "2026-09-03T10:00:00Z");
  assert.equal(first.before, null);
  assert.equal(first.periodKey, "2026");

  const second = await grade(cols, "achieved", "2026-09-20T10:00:00Z");
  assert.equal(second.before?.tier, "over_achieved");

  assert.equal(events.docs.length, 2);
  const [a, b] = events.docs;
  assert.deepEqual(a.supersededAt, new Date("2026-09-20T10:00:00Z"));
  assert.equal(b.supersededAt, null);

  // The projection every reader uses shows the latest grade.
  assert.equal(current.docs.length, 1);
  assert.equal(current.docs[0].tier, "achieved");
  assert.equal(current.docs[0].periodKey, "2026");

  const { history } = await listManagerVerdictHistory(orgId, subjectUserId, goalId, cols);
  assert.deepEqual(
    history.map((h) => [h.tier, h.previousTier]),
    [
      ["over_achieved", null],
      ["achieved", "over_achieved"],
    ],
  );
});

test("grading a new period keeps last period's grade in history", async () => {
  const { cols, events } = fakes();
  await grade(cols, "role_model", "2025-12-01T00:00:00Z", { periodKey: "2025" });
  const next = await grade(cols, "achieved", "2026-02-01T00:00:00Z", { periodKey: "2026" });
  assert.equal(next.before, null, "a different period has no 'before'");
  assert.equal(events.docs.filter((e) => e.supersededAt === null).length, 2);
});

test("back-filling an older period doesn't clobber the current grade", async () => {
  const { cols, current } = fakes();
  await grade(cols, "achieved", "2026-05-01T00:00:00Z", { periodKey: "2026" });
  const back = await grade(cols, "not_achieved", "2026-05-02T00:00:00Z", {
    periodKey: "2025",
  });
  assert.equal(back.current, false);
  assert.equal(current.docs[0].tier, "achieved");
  assert.equal(current.docs[0].periodKey, "2026");
});

test("the first write on a legacy row backfills it into history", async () => {
  const { cols, events } = fakes([
    {
      orgId,
      subjectUserId,
      goalId,
      tier: "over_achieved",
      note: "legacy note",
      gradedBy: managerId,
      gradedByName: "Ana",
      gradedAt: new Date("2026-03-01T00:00:00Z"),
      updatedAt: new Date("2026-03-01T00:00:00Z"),
    },
  ]);
  const r = await grade(cols, "achieved", "2026-09-01T00:00:00Z");
  assert.equal(r.before?.tier, "over_achieved", "the legacy grade is the 'before'");
  assert.equal(events.docs.length, 2);
  assert.equal(events.docs[0].legacy, true);
  assert.ok(events.docs[0].supersededAt instanceof Date);
});

// ─── acknowledgement ─────────────────────────────────────────────────

test("a report can acknowledge, disagree, and a re-grade clears it", async () => {
  const { cols, current, events } = fakes();
  assert.equal(
    await acknowledgeManagerVerdict(
      { orgId, subjectUserId, goalId, disagree: false, note: "" },
      cols,
    ),
    null,
    "nothing to acknowledge before a grade exists",
  );

  await grade(cols, "achieved", "2026-09-20T10:00:00Z");
  const seen = await acknowledgeManagerVerdict(
    {
      orgId,
      subjectUserId,
      goalId,
      disagree: false,
      note: "dropped when not disagreeing",
      now: new Date("2026-09-21T00:00:00Z"),
    },
    cols,
  );
  assert.ok(seen && !("stale" in seen));
  assert.equal(seen.ack.disagree, false);
  assert.equal(seen.ack.note, "");

  const disagree = await acknowledgeManagerVerdict(
    { orgId, subjectUserId, goalId, disagree: true, note: "I shipped Q3 early" },
    cols,
  );
  assert.ok(disagree && !("stale" in disagree));
  assert.equal(disagree.ack.note, "I shipped Q3 early");
  assert.equal(current.docs[0].ack.disagree, true);
  assert.equal(events.docs[0].ack.disagree, true, "mirrored onto the history row");

  await grade(cols, "over_achieved", "2026-09-25T10:00:00Z");
  assert.equal(current.docs[0].ack, null, "a new grade hasn't been seen yet");
  assert.equal(events.docs[0].ack.disagree, true, "the old grade keeps its ack");
});

test("acknowledging a legacy grade backfills its history row", async () => {
  const { cols, events, current } = fakes([
    {
      orgId,
      subjectUserId,
      goalId,
      tier: "achieved",
      note: "",
      gradedBy: managerId,
      gradedByName: "Ana",
      gradedAt: new Date("2026-01-10T00:00:00Z"),
      updatedAt: new Date("2026-01-10T00:00:00Z"),
    },
  ]);
  await acknowledgeManagerVerdict(
    { orgId, subjectUserId, goalId, disagree: false, note: "" },
    cols,
  );
  assert.equal(events.docs.length, 1);
  assert.equal(events.docs[0].legacy, true);
  assert.equal(events.docs[0].ack.disagree, false);
  assert.ok(current.docs[0].eventId.equals(events.docs[0]._id));
});

// ─── review fixes: no-op re-grade, stale ack, concurrent grades ──────

test("re-saving the same tier + note is a no-op that keeps the ack", async () => {
  const { cols, current, events } = fakes();
  await grade(cols, "achieved", "2026-09-20T10:00:00Z");
  await acknowledgeManagerVerdict(
    { orgId, subjectUserId, goalId, disagree: true, note: "I disagree" },
    cols,
  );
  const again = await grade(cols, "achieved", "2026-09-22T10:00:00Z");
  assert.equal(again.unchanged, true);
  assert.equal(events.docs.length, 1, "no duplicate history row");
  assert.equal(current.docs[0].ack.disagree, true, "the dispute survives");

  const changed = await grade(cols, "role_model", "2026-09-23T10:00:00Z");
  assert.equal(changed.unchanged, false);
  assert.equal(current.docs[0].ack, null);
});

test("an ack for a grade that was just replaced is refused, not misapplied", async () => {
  const { cols, current } = fakes();
  await grade(cols, "achieved", "2026-09-20T10:00:00Z");
  const seenEventId = current.docs[0].eventId;
  await grade(cols, "role_model", "2026-09-21T10:00:00Z");
  const r = await acknowledgeManagerVerdict(
    { orgId, subjectUserId, goalId, disagree: false, note: "", eventId: seenEventId },
    cols,
  );
  assert.deepEqual(r, { stale: true });
  assert.equal(current.docs[0].ack, null, "the newer grade stays un-seen");
});

test("an ack whose grade is replaced between read and write is refused", async () => {
  const { cols, current } = fakes();
  await grade(cols, "achieved", "2026-09-20T10:00:00Z");
  // Simulate a re-grade landing right after acknowledge reads the row.
  const realFindOne = current.findOne.bind(current);
  current.findOne = async (filter, opts) => {
    const row = await realFindOne(filter, opts);
    current.findOne = realFindOne;
    await grade(cols, "role_model", "2026-09-21T10:00:00Z");
    return row;
  };
  const r = await acknowledgeManagerVerdict(
    { orgId, subjectUserId, goalId, disagree: false, note: "" },
    cols,
  );
  assert.deepEqual(r, { stale: true });
  assert.equal(current.docs[0].tier, "role_model");
  assert.equal(current.docs[0].ack, null);
});

test("an acknowledgement reports the ack it replaced", async () => {
  const { cols } = fakes();
  await grade(cols, "achieved", "2026-09-20T10:00:00Z");
  const first = await acknowledgeManagerVerdict(
    { orgId, subjectUserId, goalId, disagree: true, note: "x" },
    cols,
  );
  assert.ok(first && !("stale" in first));
  assert.equal(first.previousAck, null);
  const second = await acknowledgeManagerVerdict(
    { orgId, subjectUserId, goalId, disagree: true, note: "x" },
    cols,
  );
  assert.ok(second && !("stale" in second));
  assert.equal(second.previousAck?.disagree, true);
  assert.equal(isNewDispute(second.previousAck, second.ack), false);
});

test("a concurrent grade's duplicate-key collision is retried as a supersede", async () => {
  const { cols, events } = fakes();
  await grade(cols, "achieved", "2026-09-20T10:00:00Z");
  // The first insert collides (another writer's active row landed after
  // our supersede) — emulate by inserting that row and throwing E11000.
  const realInsert = events.insertOne.bind(events);
  let collided = false;
  events.insertOne = async (doc) => {
    if (!collided) {
      collided = true;
      await realInsert({
        orgId,
        subjectUserId,
        goalId,
        periodKey: "2026",
        tier: "over_achieved",
        note: "concurrent",
        gradedBy: managerId,
        gradedByName: "Bo",
        gradedAt: new Date("2026-09-21T09:00:00Z"),
        supersededAt: null,
        legacy: false,
        ack: null,
      });
      throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
    }
    return realInsert(doc);
  };
  const r = await grade(cols, "role_model", "2026-09-21T10:00:00Z");
  assert.equal(r.before?.tier, "over_achieved", "before is the concurrent grade");
  const active = events.docs.filter((e) => e.supersededAt === null);
  assert.equal(active.length, 1, "exactly one active grade per period");
  assert.equal(active[0].tier, "role_model");
});

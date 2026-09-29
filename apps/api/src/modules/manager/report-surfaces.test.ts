import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

import {
  createReportNote,
  deleteReportNote,
  listMyManagerNotes,
  listReportNotes,
  reportSnapshots,
  teamGradingProgress,
  teamTrends,
  updateReportNote,
  type SurfaceDeps,
  type SurfaceSession,
} from "./report-surfaces.js";
import { FakeCollection, asCollection } from "../../lib/fake-collection.test-support.js";
import type { AuditInput } from "../../lib/audit.js";

const orgA = new ObjectId();
const orgB = new ObjectId();
const manager = new ObjectId();
const otherManager = new ObjectId();

function mkUser(over: Record<string, unknown>) {
  return {
    _id: new ObjectId(),
    orgId: orgA,
    managerId: manager,
    status: "active",
    displayName: "Someone",
    email: "someone@example.com",
    ...over,
  };
}

const managerUser = mkUser({ _id: manager, managerId: null, displayName: "Ana Lead" });
const mine = mkUser({ displayName: "Mine" });
const mine2 = mkUser({ displayName: "Also mine" });
const stranger = mkUser({ managerId: otherManager, displayName: "Stranger" });
const disabled = mkUser({ status: "disabled", displayName: "Gone" });
const crossOrg = mkUser({ orgId: orgB, displayName: "Elsewhere" });

const session: SurfaceSession = { orgId: orgA, userId: manager, role: "manager" };
const meta = { ip: null, ua: null };

function setup() {
  const users = new FakeCollection([managerUser, mine, mine2, stranger, disabled, crossOrg]);
  const snapshots = new FakeCollection([
    { orgId: orgA, userId: mine._id, week: "W37-2026", capturedAt: new Date("2026-09-13"), capturedBy: "manual", partial: false, gaps: [], merged: 3, reviews: 2, goalReadings: {}, note: "private" },
    { orgId: orgA, userId: mine._id, week: "W38-2026", capturedAt: new Date("2026-09-20"), capturedBy: "manual", partial: false, gaps: [], merged: 5, reviews: 1, goalReadings: {}, note: "private" },
    { orgId: orgA, userId: stranger._id, week: "W38-2026", capturedAt: new Date("2026-09-20"), capturedBy: "manual", partial: false, gaps: [], merged: 9, reviews: 9, goalReadings: {}, note: "" },
  ]);
  const verdictEvents = new FakeCollection([
    { orgId: orgA, subjectUserId: mine._id, goalId: "g1", periodKey: "2026", tier: "achieved", gradedAt: new Date("2026-03-01"), supersededAt: null, ack: null },
    { orgId: orgA, subjectUserId: mine._id, goalId: "g2", periodKey: "2026", tier: "role_model", gradedAt: new Date("2026-03-01"), supersededAt: null, ack: { at: new Date(), disagree: true, note: "no" } },
    { orgId: orgA, subjectUserId: mine._id, goalId: "g1", periodKey: "2025", tier: "not_achieved", gradedAt: new Date("2025-03-01"), supersededAt: null, ack: null },
    { orgId: orgA, subjectUserId: stranger._id, goalId: "g1", periodKey: "2026", tier: "achieved", gradedAt: new Date("2026-03-01"), supersededAt: null, ack: null },
  ]);
  const notes = new FakeCollection();
  const audits: AuditInput[] = [];
  const deps: SurfaceDeps = {
    users: asCollection(users),
    snapshots: asCollection(snapshots),
    verdictEvents: asCollection(verdictEvents),
    notes: asCollection(notes),
    goalIdsFor: async (_orgId, ids) =>
      new Map(ids.map((id) => [id.toHexString(), ["g1", "g2", "g3"]])),
    audit: async (a) => {
      audits.push(a);
    },
    now: () => new Date("2026-09-28T10:00:00Z"),
  };
  return { deps, notes, audits };
}

async function is404(p: Promise<unknown>) {
  await assert.rejects(p, (err: unknown) => {
    const e = err as { status?: number; statusCode?: number };
    assert.equal(e.status ?? e.statusCode, 404);
    return true;
  });
}

async function is401(p: Promise<unknown>) {
  await assert.rejects(p, (err: unknown) => {
    const e = err as { status?: number; statusCode?: number };
    assert.equal(e.status ?? e.statusCode, 401);
    return true;
  });
}

const refused = [stranger, disabled, crossOrg];

// ─── grading progress ────────────────────────────────────────────────

test("grading progress covers only my active reports, current year by default", async () => {
  const { deps } = setup();
  const out = await teamGradingProgress(session, undefined, deps);
  assert.equal(out.periodKey, "2026");
  assert.deepEqual(out.reports.map((r) => r.displayName).sort(), ["Also mine", "Mine"]);
  const m = out.reports.find((r) => r.displayName === "Mine")!;
  assert.equal(m.total, 3);
  assert.equal(m.graded, 2);
  assert.equal(m.disputed, 1);
  assert.equal(m.byTier.role_model, 1);
  assert.equal(out.totals.total, 6);
  assert.equal(out.totals.graded, 2);
});

test("grading progress honours a period key and rejects a bad one", async () => {
  const { deps } = setup();
  const out = await teamGradingProgress(session, "2025", deps);
  assert.equal(out.reports.find((r) => r.displayName === "Mine")!.graded, 1);
  await assert.rejects(teamGradingProgress(session, "last year", deps));
});

test("grading progress and team trends need a session", async () => {
  const { deps } = setup();
  await is401(teamGradingProgress(null, undefined, deps));
  await is401(teamTrends(null, undefined, deps));
});

test("a manager with no reports gets an empty rollup, not an error", async () => {
  const { deps } = setup();
  const out = await teamGradingProgress(
    { orgId: orgA, userId: new ObjectId(), role: "manager" },
    undefined,
    deps,
  );
  assert.equal(out.reports.length, 0);
  assert.equal(out.totals.total, 0);
});

// ─── snapshots ───────────────────────────────────────────────────────

test("report snapshots: own report ok, oldest week first, no private note", async () => {
  const { deps } = setup();
  const out = await reportSnapshots(session, mine._id.toHexString(), undefined, deps);
  assert.deepEqual(out.series.map((p) => p.merged), [3, 5]);
  assert.equal("note" in out.series[0], false);
});

test("report snapshots: stranger / disabled / cross-org / malformed → 404", async () => {
  const { deps } = setup();
  for (const u of refused) {
    await is404(reportSnapshots(session, u._id.toHexString(), undefined, deps));
  }
  await is404(reportSnapshots(session, "nope", undefined, deps));
});

test("team trends include only my active reports", async () => {
  const { deps } = setup();
  const out = await teamTrends(session, "8", deps);
  assert.equal(out.weeks, 8);
  assert.deepEqual(out.reports.map((r) => r.displayName).sort(), ["Also mine", "Mine"]);
  assert.equal(out.reports.some((r) => r.series.some((p) => p.merged === 9)), false);
});

// ─── notes ───────────────────────────────────────────────────────────

test("notes: own report CRUD works and writes audit rows without the text", async () => {
  const { deps, audits } = setup();
  const id = mine._id.toHexString();
  const { note } = await createReportNote(session, id, { body: "  Talked about Q4  " }, meta, deps);
  assert.equal(note.body, "Talked about Q4");
  assert.equal(note.visibility, "private");
  assert.equal(note.managerName, "Ana Lead");

  const edited = await updateReportNote(session, id, note.id, { visibility: "shared-with-report" }, meta, deps);
  assert.equal(edited.note.visibility, "shared-with-report");
  assert.equal(edited.note.body, "Talked about Q4");

  assert.equal((await listReportNotes(session, id, deps)).notes.length, 1);
  await deleteReportNote(session, id, note.id, meta, deps);
  assert.equal((await listReportNotes(session, id, deps)).notes.length, 0);

  assert.deepEqual(
    audits.map((a) => a.action),
    ["manager.note.create", "manager.note.update", "manager.note.delete"],
  );
  assert.equal(JSON.stringify(audits).includes("Talked about"), false);
});

test("notes: stranger / disabled / cross-org → 404 on every verb", async () => {
  const { deps, notes } = setup();
  for (const u of refused) {
    const id = u._id.toHexString();
    await is404(listReportNotes(session, id, deps));
    await is404(createReportNote(session, id, { body: "x" }, meta, deps));
    await is404(updateReportNote(session, id, new ObjectId().toHexString(), { body: "x" }, meta, deps));
    await is404(deleteReportNote(session, id, new ObjectId().toHexString(), meta, deps));
  }
  assert.equal(notes.docs.length, 0);
});

test("notes: another manager's note on my report is invisible and untouchable", async () => {
  const { deps, notes } = setup();
  const theirs = new ObjectId();
  notes.docs.push({
    _id: theirs,
    orgId: orgA,
    managerId: otherManager,
    reportId: mine._id,
    managerName: "Previous lead",
    body: "old private note",
    visibility: "private",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const id = mine._id.toHexString();
  assert.equal((await listReportNotes(session, id, deps)).notes.length, 0);
  await is404(updateReportNote(session, id, theirs.toHexString(), { body: "mine now" }, meta, deps));
  await is404(deleteReportNote(session, id, theirs.toHexString(), meta, deps));
  assert.equal(notes.docs[0].body, "old private note");
});

test("notes: validation — empty body, bad visibility, empty patch, bad note id", async () => {
  const { deps } = setup();
  const id = mine._id.toHexString();
  await assert.rejects(createReportNote(session, id, { body: "   " }, meta, deps));
  await assert.rejects(createReportNote(session, id, { body: "x", visibility: "everyone" }, meta, deps));
  const { note } = await createReportNote(session, id, { body: "x" }, meta, deps);
  await assert.rejects(updateReportNote(session, id, note.id, {}, meta, deps));
  await is404(updateReportNote(session, id, "nope", { body: "y" }, meta, deps));
});

test("my-manager-notes: the report sees only notes about them marked shared", async () => {
  const { deps } = setup();
  const id = mine._id.toHexString();
  await createReportNote(session, id, { body: "private one" }, meta, deps);
  await createReportNote(session, id, { body: "shared one", visibility: "shared-with-report" }, meta, deps);
  await createReportNote(session, mine2._id.toHexString(), { body: "about someone else", visibility: "shared-with-report" }, meta, deps);

  const out = await listMyManagerNotes({ orgId: orgA, userId: mine._id }, deps);
  assert.deepEqual(out.notes.map((n) => n.body), ["shared one"]);
  assert.equal(out.notes[0].managerName, "Ana Lead");

  // Same user id in another org sees nothing.
  const other = await listMyManagerNotes({ orgId: orgB, userId: mine._id }, deps);
  assert.equal(other.notes.length, 0);
  await is401(listMyManagerNotes(null, deps));
});

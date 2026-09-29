/**
 * The manager's team-level surfaces from docs/hub-audit.md §1.5, as
 * plain functions over injected collections so their authorization is
 * unit-tested against fakes (report-surfaces.test.ts) without Mongo.
 *
 *   teamGradingProgress   GET /manager/grading-progress
 *   teamTrends            GET /manager/team-trends
 *   reportSnapshots       GET /manager/reports/:userId/snapshots
 *   listReportNotes       GET /manager/reports/:userId/notes
 *   createReportNote      POST /manager/reports/:userId/notes
 *   updateReportNote      PATCH /manager/reports/:userId/notes/:noteId
 *   deleteReportNote      DELETE /manager/reports/:userId/notes/:noteId
 *   listMyManagerNotes    GET /my-manager-notes (the REPORT's side)
 *
 * Boundaries:
 *   - team-level reads cover `managerId === session.userId` active
 *     reports in the session's org — the same query as /manager/reports;
 *   - every per-report route goes through resolveReportFor (404 for a
 *     stranger, another org, a disabled report, a malformed id);
 *   - notes are additionally scoped to their AUTHOR: a manager reads and
 *     edits only notes they wrote, so a reassigned report's previous
 *     manager's private notes never transfer with the report;
 *   - a report reads only notes about THEM marked "shared-with-report".
 */

import { ObjectId, type Collection } from "mongodb";
import { z } from "zod";
import type { AuditInput } from "../../lib/audit.js";
import {
  defaultPeriodKey,
  isValidPeriodKey,
} from "../../lib/manager-verdicts.js";
import { HttpError } from "../../middleware/error-handler.js";
import type {
  ManagerGoalVerdictEvent,
  ManagerReportNote,
  Snapshot,
  User,
  UserRole,
} from "../../db/types.js";
import { resolveReportFor } from "./resolve-report.js";
import {
  gradingProgressFor,
  snapshotSeries,
  sumGradingProgress,
  type GradingProgress,
  type SnapshotPoint,
} from "./team-stats.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type FindCursor<T> = {
  sort(s: Record<string, 1 | -1>): FindCursor<T>;
  limit(n: number): FindCursor<T>;
  toArray(): Promise<T[]>;
};

/** The slice of a Mongo collection these functions use — fakes fit it. */
export interface MiniCollection<T> {
  findOne(filter: Record<string, any>, opts?: any): Promise<T | null>;
  find(filter: Record<string, any>, opts?: any): FindCursor<T>;
}
export interface NotesCollection extends MiniCollection<ManagerReportNote> {
  insertOne(doc: any): Promise<unknown>;
  updateOne(filter: Record<string, any>, update: Record<string, any>): Promise<{ matchedCount: number }>;
  deleteOne(filter: Record<string, any>): Promise<{ deletedCount: number }>;
}

export interface SurfaceDeps {
  users: MiniCollection<User>;
  snapshots: MiniCollection<Snapshot>;
  verdictEvents: MiniCollection<ManagerGoalVerdictEvent>;
  notes: NotesCollection;
  /**
   * Each report's current goal ids (own tree + assigned goals), keyed by
   * user hex id — batch-loaded for the whole team in a fixed number of
   * queries, never one round trip per report.
   */
  goalIdsFor: (orgId: ObjectId, userIds: ObjectId[]) => Promise<Map<string, string[]>>;
  audit: (input: AuditInput) => Promise<void>;
  now?: () => Date;
}

export interface SurfaceSession {
  orgId: ObjectId;
  userId: ObjectId;
  role: UserRole;
}

export interface RequestMeta {
  ip: string | null;
  ua: string | null;
}

/** Cast real collections into the injected shape. */
export function asMini<T>(c: Collection<any>): T {
  return c as unknown as T;
}

function requireSession<S>(session: S | null | undefined): S {
  if (!session) throw new HttpError(401, "unauthenticated", "Login required.");
  return session;
}

function resolve(session: SurfaceSession | null | undefined, rawId: unknown, deps: SurfaceDeps) {
  return resolveReportFor(session, rawId, (q) => deps.users.findOne(q));
}

async function activeReports(session: SurfaceSession, deps: SurfaceDeps): Promise<User[]> {
  return deps.users
    .find({
      orgId: session.orgId,
      managerId: session.userId,
      status: { $ne: "disabled" },
    })
    .sort({ displayName: 1 })
    .toArray();
}

// ─── grading progress + calibration ──────────────────────────────────

export interface TeamGradingProgress {
  periodKey: string;
  totals: GradingProgress;
  reports: (GradingProgress & { id: string; displayName: string })[];
}

/** Parse `?periodKey=`; defaults to the current calendar year. */
export function periodKeyFrom(raw: unknown, now: Date): string {
  if (raw === undefined || raw === null || raw === "") return defaultPeriodKey(now);
  if (!isValidPeriodKey(raw)) {
    throw new HttpError(400, "invalid_period", 'periodKey must look like "2026" or "2026-Q1".');
  }
  return raw;
}

export async function teamGradingProgress(
  rawSession: SurfaceSession | null | undefined,
  rawPeriodKey: unknown,
  deps: SurfaceDeps,
): Promise<TeamGradingProgress> {
  const session = requireSession(rawSession);
  const periodKey = periodKeyFrom(rawPeriodKey, deps.now?.() ?? new Date());
  const reports = await activeReports(session, deps);
  if (reports.length === 0) {
    return { periodKey, totals: sumGradingProgress([]), reports: [] };
  }
  const reportIds = reports.map((u) => u._id);
  const [goalIds, events] = await Promise.all([
    deps.goalIdsFor(session.orgId, reportIds),
    deps.verdictEvents
      .find(
        {
          orgId: session.orgId,
          subjectUserId: { $in: reportIds },
          periodKey,
        },
        {
          projection: {
            subjectUserId: 1,
            goalId: 1,
            periodKey: 1,
            tier: 1,
            gradedAt: 1,
            supersededAt: 1,
            ack: 1,
          },
        },
      )
      .toArray(),
  ]);
  const eventsBy = groupBy(events, (e) => e.subjectUserId.toHexString());
  const rows = reports.map((u) => ({
    id: u._id.toHexString(),
    displayName: u.displayName,
    ...gradingProgressFor(
      goalIds.get(u._id.toHexString()) ?? [],
      eventsBy.get(u._id.toHexString()) ?? [],
      periodKey,
    ),
  }));
  return { periodKey, totals: sumGradingProgress(rows), reports: rows };
}

// ─── snapshots (team trend) ──────────────────────────────────────────

const weeksSchema = z.coerce.number().int().min(2).max(104).default(12);

/** The snapshot fields a trend point is built from — not the note, not raw metrics. */
const SNAPSHOT_TREND_PROJECTION = {
  userId: 1,
  week: 1,
  capturedAt: 1,
  capturedBy: 1,
  partial: 1,
  gaps: 1,
  merged: 1,
  reviews: 1,
  goalReadings: 1,
} as const;

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

async function seriesFor(
  orgId: ObjectId,
  userId: ObjectId,
  weeks: number,
  deps: SurfaceDeps,
): Promise<SnapshotPoint[]> {
  const rows = await deps.snapshots
    .find({ orgId, userId }, { projection: SNAPSHOT_TREND_PROJECTION })
    .sort({ capturedAt: -1 })
    // Room for duplicate captures of the same week before dedupe.
    .limit(weeks * 2)
    .toArray();
  return snapshotSeries(rows).slice(-weeks);
}

export async function reportSnapshots(
  rawSession: SurfaceSession | null | undefined,
  rawUserId: unknown,
  rawWeeks: unknown,
  deps: SurfaceDeps,
): Promise<{ userId: string; series: SnapshotPoint[] }> {
  const target = await resolve(rawSession, rawUserId, deps);
  const session = rawSession!;
  const weeks = weeksSchema.parse(rawWeeks);
  return {
    userId: target._id.toHexString(),
    series: await seriesFor(session.orgId, target._id, weeks, deps),
  };
}

export async function teamTrends(
  rawSession: SurfaceSession | null | undefined,
  rawWeeks: unknown,
  deps: SurfaceDeps,
): Promise<{ weeks: number; reports: { id: string; displayName: string; series: SnapshotPoint[] }[] }> {
  const session = requireSession(rawSession);
  const weeks = weeksSchema.parse(rawWeeks);
  const reports = await activeReports(session, deps);
  if (reports.length === 0) return { weeks, reports: [] };
  // One query for the whole team (not one per report), projected to the
  // trend fields and bounded to the window: weeks × 2 back leaves the same
  // room for duplicate captures of one week that seriesFor's limit does.
  const now = deps.now?.() ?? new Date();
  const since = new Date(now.getTime() - weeks * 2 * 7 * 86_400_000);
  const rows = await deps.snapshots
    .find(
      {
        orgId: session.orgId,
        userId: { $in: reports.map((u) => u._id) },
        capturedAt: { $gte: since },
      },
      { projection: SNAPSHOT_TREND_PROJECTION },
    )
    .sort({ capturedAt: -1 })
    .toArray();
  const byUser = groupBy(rows, (r) => r.userId.toHexString());
  return {
    weeks,
    reports: reports.map((u) => ({
      id: u._id.toHexString(),
      displayName: u.displayName,
      series: snapshotSeries(
        (byUser.get(u._id.toHexString()) ?? []).slice(0, weeks * 2),
      ).slice(-weeks),
    })),
  };
}

// ─── 1:1 notes ───────────────────────────────────────────────────────

export const NOTE_VISIBILITIES = ["private", "shared-with-report"] as const;

const createNoteSchema = z.object({
  body: z.string().trim().min(1, "Write something first.").max(10_000),
  visibility: z.enum(NOTE_VISIBILITIES).default("private"),
});

const updateNoteSchema = z
  .object({
    body: z.string().trim().min(1, "A note can't be empty.").max(10_000).optional(),
    visibility: z.enum(NOTE_VISIBILITIES).optional(),
  })
  .refine((v) => v.body !== undefined || v.visibility !== undefined, {
    message: "Nothing to change.",
  });

export interface NoteJson {
  id: string;
  body: string;
  visibility: ManagerReportNote["visibility"];
  managerName: string;
  createdAt: string;
  updatedAt: string;
}

export function noteToJson(n: ManagerReportNote): NoteJson {
  return {
    id: n._id.toHexString(),
    body: n.body,
    visibility: n.visibility,
    managerName: n.managerName,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

function noteIdFrom(raw: unknown): ObjectId {
  if (typeof raw !== "string" || !/^[0-9a-fA-F]{24}$/.test(raw)) {
    throw new HttpError(404, "not_found", "No such note.");
  }
  return new ObjectId(raw);
}

export async function listReportNotes(
  rawSession: SurfaceSession | null | undefined,
  rawUserId: unknown,
  deps: SurfaceDeps,
): Promise<{ notes: NoteJson[] }> {
  const target = await resolve(rawSession, rawUserId, deps);
  const session = rawSession!;
  const rows = await deps.notes
    .find({ orgId: session.orgId, managerId: session.userId, reportId: target._id })
    .sort({ createdAt: -1 })
    .limit(500)
    .toArray();
  return { notes: rows.map(noteToJson) };
}

export async function createReportNote(
  rawSession: SurfaceSession | null | undefined,
  rawUserId: unknown,
  rawBody: unknown,
  meta: RequestMeta,
  deps: SurfaceDeps,
): Promise<{ note: NoteJson }> {
  const target = await resolve(rawSession, rawUserId, deps);
  const session = rawSession!;
  const body = createNoteSchema.parse(rawBody ?? {});
  const manager = await deps.users.findOne({ _id: session.userId, orgId: session.orgId });
  const now = deps.now?.() ?? new Date();
  const doc: ManagerReportNote = {
    _id: new ObjectId(),
    orgId: session.orgId,
    managerId: session.userId,
    reportId: target._id,
    managerName: (manager?.displayName ?? "Your manager").slice(0, 200),
    body: body.body,
    visibility: body.visibility,
    createdAt: now,
    updatedAt: now,
  };
  await deps.notes.insertOne(doc);
  // The note's text stays out of the audit log — it's a private journal;
  // the trail records that a note exists and who could read it.
  await deps.audit({
    orgId: session.orgId,
    actorUserId: session.userId,
    actorRole: session.role,
    action: "manager.note.create",
    targetType: "user",
    targetId: target._id.toHexString(),
    after: { noteId: doc._id.toHexString(), visibility: doc.visibility, length: doc.body.length },
    ...meta,
  });
  return { note: noteToJson(doc) };
}

export async function updateReportNote(
  rawSession: SurfaceSession | null | undefined,
  rawUserId: unknown,
  rawNoteId: unknown,
  rawBody: unknown,
  meta: RequestMeta,
  deps: SurfaceDeps,
): Promise<{ note: NoteJson }> {
  const target = await resolve(rawSession, rawUserId, deps);
  const session = rawSession!;
  const noteId = noteIdFrom(rawNoteId);
  const patch = updateNoteSchema.parse(rawBody ?? {});
  const key = {
    _id: noteId,
    orgId: session.orgId,
    managerId: session.userId,
    reportId: target._id,
  };
  const before = await deps.notes.findOne(key);
  if (!before) throw new HttpError(404, "not_found", "No such note.");
  const now = deps.now?.() ?? new Date();
  const set: Partial<ManagerReportNote> = { updatedAt: now };
  if (patch.body !== undefined) set.body = patch.body;
  if (patch.visibility !== undefined) set.visibility = patch.visibility;
  await deps.notes.updateOne(key, { $set: set });
  const after = { ...before, ...set } as ManagerReportNote;
  await deps.audit({
    orgId: session.orgId,
    actorUserId: session.userId,
    actorRole: session.role,
    action: "manager.note.update",
    targetType: "user",
    targetId: target._id.toHexString(),
    before: { noteId: noteId.toHexString(), visibility: before.visibility, length: before.body.length },
    after: { noteId: noteId.toHexString(), visibility: after.visibility, length: after.body.length },
    ...meta,
  });
  return { note: noteToJson(after) };
}

export async function deleteReportNote(
  rawSession: SurfaceSession | null | undefined,
  rawUserId: unknown,
  rawNoteId: unknown,
  meta: RequestMeta,
  deps: SurfaceDeps,
): Promise<{ ok: true }> {
  const target = await resolve(rawSession, rawUserId, deps);
  const session = rawSession!;
  const noteId = noteIdFrom(rawNoteId);
  const key = {
    _id: noteId,
    orgId: session.orgId,
    managerId: session.userId,
    reportId: target._id,
  };
  const before = await deps.notes.findOne(key);
  if (!before) throw new HttpError(404, "not_found", "No such note.");
  await deps.notes.deleteOne(key);
  await deps.audit({
    orgId: session.orgId,
    actorUserId: session.userId,
    actorRole: session.role,
    action: "manager.note.delete",
    targetType: "user",
    targetId: target._id.toHexString(),
    before: { noteId: noteId.toHexString(), visibility: before.visibility, length: before.body.length },
    ...meta,
  });
  return { ok: true };
}

/**
 * The REPORT's read: every note about the caller that its author shared
 * with them, newest first. Private notes never appear, whoever wrote them.
 */
export async function listMyManagerNotes(
  rawSession: Pick<SurfaceSession, "orgId" | "userId"> | null | undefined,
  deps: Pick<SurfaceDeps, "notes">,
): Promise<{ notes: NoteJson[] }> {
  const session = requireSession(rawSession);
  const rows = await deps.notes
    .find({
      orgId: session.orgId,
      reportId: session.userId,
      visibility: "shared-with-report",
    })
    .sort({ createdAt: -1 })
    .limit(500)
    .toArray();
  return { notes: rows.map(noteToJson) };
}

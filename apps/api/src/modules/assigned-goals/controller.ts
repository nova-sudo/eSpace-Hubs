/**
 * Assigned (shared) goals controller.
 *
 * A manager authors ONE goal (a COMPOSED plan), assigns it to people who
 * fill it inside their own goal tree, and shares its analytics with
 * viewers. Access rules:
 *   - create / edit / archive  → the creator (create also needs
 *     `assigned_goals.manage`, enforced in routes.ts)
 *   - progress + cell detail   → creator or viewer
 *   - grading an assignee      → the creator (a manager verdict of record)
 *   - meta (GET /:id), "my progress" → creator, viewer or assignee
 *   - anyone else              → 404, never 403 (don't leak existence)
 */

import type { NextFunction, Request, Response } from "express";
import { ObjectId } from "mongodb";
import {
  assignedGoalId,
  cycleEndForCount,
  toIsoDay,
  validateSpec,
} from "@espace-devhub/shared/goal-specs";
import {
  getAssignedGoalsCollection,
  getGoalInputsCollection,
  getUsersCollection,
} from "../../db/collections.js";
import type { AssignedGoal, User } from "../../db/types.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { canFillGoals } from "../../lib/assigned-goals.js";
import { createNotification } from "../../lib/notifications.js";
import { effectiveRoles } from "../../lib/user-roles.js";
import { HttpError } from "../../middleware/error-handler.js";
import { buildProgress } from "./progress.js";
import {
  DEFAULT_TIME_ZONE,
  createAssignedGoalSchema,
  listQuerySchema,
  patchAssignedGoalSchema,
  verdictSchema,
} from "./schemas.js";
import {
  getManagerGoalVerdictsCollection,
} from "../../db/collections.js";
import { upsertManagerVerdict } from "../../lib/manager-verdicts.js";

const DRAFT_GOAL_ID = "asg_draft";

function requireSession(req: Request) {
  const session = req.session;
  if (!session) throw new HttpError(401, "unauthenticated", "Login required.");
  return session;
}

function notFound(): never {
  throw new HttpError(404, "not_found", "No such shared goal.");
}

async function loadGoal(req: Request, orgId: ObjectId): Promise<AssignedGoal> {
  const raw = req.params.id;
  if (typeof raw !== "string" || !ObjectId.isValid(raw)) notFound();
  const col = await getAssignedGoalsCollection();
  const doc = await col.findOne({ _id: new ObjectId(raw), orgId });
  if (!doc) notFound();
  return doc;
}

const has = (ids: ObjectId[], id: ObjectId) => ids.some((x) => x.equals(id));
const isCreator = (doc: AssignedGoal, uid: ObjectId) => doc.createdBy.equals(uid);
const canViewProgress = (doc: AssignedGoal, uid: ObjectId) =>
  isCreator(doc, uid) || has(doc.viewerIds, uid);

// ─── spec rules ──────────────────────────────────────────────────────

/**
 * Validate + normalise the plan. Rules on top of `validateSpec`:
 *   - COMPOSED only (the form-style widget every assignee can fill)
 *   - no approval / delegated blocks — the creator IS the approval
 * Repo-read (`source`) fields are allowed: each assignee answers the setup
 * questions for their own repos, and the query spends their own token.
 * Nested periods and a management half are allowed too; analytics grades
 * the top-level periods (a nested save counts toward its parent period,
 * the management track never counts as a submission).
 * The cycle bounds are stamped here (start defaults to today) so every
 * assignee's widget sees the same windows and its self-heal is a no-op.
 */
export function checkAssignableSpec(input: Record<string, unknown>): Record<string, unknown> {
  const { approval: _a, delegated: _d, ...rest } = input as Record<string, unknown>;
  const result = validateSpec({ ...rest, goalId: DRAFT_GOAL_ID });
  if (!result.ok) {
    throw new HttpError(400, "validation_error", "The plan failed validation.", result.errors);
  }
  const spec = result.spec as unknown as Record<string, any>;
  const problems: string[] = [];
  if (spec.widget !== "COMPOSED") problems.push("Shared goals must use a form-style (composed) plan.");
  const composed = (spec.composed ?? {}) as Record<string, any>;
  const periods: Array<Record<string, any>> = Array.isArray(composed.periods) ? composed.periods : [];
  if (problems.length > 0) {
    throw new HttpError(400, "validation_error", problems[0], problems);
  }

  // Stamp the cycle bounds.
  const cadence = composed.cadence || null;
  const count = periods.length || composed.periodCount || 0;
  // `validateSpec` drops a start that arrives without an end, so read the
  // raw input too — a plan that says "starts 1 Sep, 13 weeks" must not
  // silently start today.
  const rawComposed = ((input as Record<string, any>).composed ?? {}) as Record<string, any>;
  const cycleStart =
    toIsoDay(composed.cycleStart) ??
    toIsoDay(rawComposed.cycleStart) ??
    new Date().toISOString().slice(0, 10);
  let cycleEnd = toIsoDay(composed.cycleEnd) ?? toIsoDay(rawComposed.cycleEnd);
  if (cadence && count > 0) cycleEnd = cycleEndForCount(cycleStart, cadence, count) ?? cycleEnd;
  if (cycleEnd && cycleEnd <= cycleStart) cycleEnd = null;
  const nextComposed: Record<string, unknown> = { ...composed, cycleStart };
  if (cycleEnd) nextComposed.cycleEnd = cycleEnd;
  else delete nextComposed.cycleEnd;

  const { goalId: _g, ...stored } = spec;
  return { ...stored, composed: nextComposed };
}

/** Did the change re-key the period grid? */
function isStructuralChange(a: Record<string, any>, b: Record<string, any>): boolean {
  const ca = a?.composed ?? {};
  const cb = b?.composed ?? {};
  return (
    (ca.cadence || null) !== (cb.cadence || null) ||
    (ca.cycleStart || null) !== (cb.cycleStart || null) ||
    (ca.cycleEnd || null) !== (cb.cycleEnd || null) ||
    (ca.periods?.length || 0) !== (cb.periods?.length || 0)
  );
}

// ─── people ──────────────────────────────────────────────────────────

async function resolvePeople(
  orgId: ObjectId,
  ids: string[],
): Promise<Map<string, User>> {
  const unique = [...new Set(ids)].map((id) => new ObjectId(id));
  if (unique.length === 0) return new Map();
  const users = await getUsersCollection();
  const rows = await users
    .find({ _id: { $in: unique }, orgId, status: "active" })
    .toArray();
  return new Map(rows.map((u) => [u._id.toHexString(), u]));
}

async function checkPeople(
  orgId: ObjectId,
  assigneeIds: string[],
  viewerIds: string[],
  /** People already on the goal — kept even if since deactivated. */
  existing: { assignees: Set<string>; viewers: Set<string> } = {
    assignees: new Set(),
    viewers: new Set(),
  },
): Promise<{ assignees: ObjectId[]; viewers: ObjectId[]; people: Map<string, User> }> {
  const newAssignees = assigneeIds.filter((id) => !existing.assignees.has(id));
  const newViewers = viewerIds.filter((id) => !existing.viewers.has(id));
  const people = await resolvePeople(orgId, [...newAssignees, ...newViewers]);
  const missing = [...newAssignees, ...newViewers].filter((id) => !people.has(id));
  if (missing.length > 0) {
    throw new HttpError(400, "validation_error", "Some people aren't active members of this org.", { missing });
  }
  const cantFill = newAssignees.filter((id) => !canFillGoals(people.get(id)!));
  if (cantFill.length > 0) {
    throw new HttpError(
      400,
      "validation_error",
      "Some assignees have no Goals page to fill this in — add them as viewers instead.",
      { cantFill },
    );
  }
  const assignees = [...new Set(assigneeIds)].map((id) => new ObjectId(id));
  // Someone who fills it doesn't also need to be a viewer.
  const assigneeSet = new Set(assigneeIds);
  const viewers = [...new Set(viewerIds)]
    .filter((id) => !assigneeSet.has(id))
    .map((id) => new ObjectId(id));
  return { assignees, viewers, people };
}

function publicUser(u: User | undefined, id: string) {
  return {
    id,
    displayName: u?.displayName || u?.email || "Former member",
    email: u?.email ?? null,
  };
}

async function toPublic(doc: AssignedGoal, opts: { withPeople?: boolean } = {}) {
  const base = {
    id: doc._id.toHexString(),
    goalId: assignedGoalId(doc._id.toHexString()),
    code: doc.code,
    title: doc.title,
    description: doc.description,
    spec: doc.spec,
    graceHours: doc.graceHours,
    timeZone: doc.timeZone || DEFAULT_TIME_ZONE,
    status: doc.status,
    archivedAt: doc.archivedAt ? doc.archivedAt.toISOString() : null,
    specRevision: doc.specRevision,
    createdBy: { id: doc.createdBy.toHexString(), displayName: doc.createdByName },
    assigneeCount: doc.assigneeIds.length,
    viewerCount: doc.viewerIds.length,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
  if (!opts.withPeople) return base;
  const people = await resolvePeopleAnyStatus(doc.orgId, [
    ...doc.assigneeIds.map(String),
    ...doc.viewerIds.map(String),
  ]);
  return {
    ...base,
    assignees: doc.assigneeIds.map((id) => publicUser(people.get(String(id)), String(id))),
    viewers: doc.viewerIds.map((id) => publicUser(people.get(String(id)), String(id))),
  };
}

async function resolvePeopleAnyStatus(orgId: ObjectId, ids: string[]) {
  const unique = [...new Set(ids)].map((id) => new ObjectId(id));
  if (unique.length === 0) return new Map<string, User>();
  const users = await getUsersCollection();
  const rows = await users.find({ _id: { $in: unique }, orgId }).toArray();
  return new Map(rows.map((u) => [u._id.toHexString(), u]));
}

function notifyMany(
  orgId: ObjectId,
  actor: ObjectId,
  ids: ObjectId[],
  build: (id: ObjectId) => {
    kind: Parameters<typeof createNotification>[0]["kind"];
    title: string;
    body: string;
    data: Record<string, unknown>;
  },
): void {
  for (const id of ids) {
    if (id.equals(actor)) continue;
    void createNotification({ orgId, userId: id, createdBy: actor, ...build(id) });
  }
}

// ─── GET /people ─────────────────────────────────────────────────────

export async function listPeopleHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const session = requireSession(req);
    const users = await getUsersCollection();
    const rows = await users
      .find(
        { orgId: session.orgId, status: "active" },
        { projection: { displayName: 1, email: 1, role: 1, roles: 1 } },
      )
      .sort({ displayName: 1 })
      .limit(2000)
      .toArray();
    res.json({
      people: rows.map((u) => ({
        id: u._id.toHexString(),
        displayName: u.displayName || u.email,
        email: u.email,
        roles: effectiveRoles(u),
        canFill: canFillGoals(u),
      })),
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST / ──────────────────────────────────────────────────────────

export async function createAssignedGoalHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const session = requireSession(req);
    const payload = createAssignedGoalSchema.parse(req.body);
    const spec = checkAssignableSpec(payload.spec);
    const { assignees, viewers } = await checkPeople(
      session.orgId,
      payload.assigneeIds,
      payload.viewerIds,
    );
    const users = await getUsersCollection();
    const me = await users.findOne({ _id: session.userId, orgId: session.orgId });
    const now = new Date();
    const doc: AssignedGoal = {
      _id: new ObjectId(),
      orgId: session.orgId,
      createdBy: session.userId,
      createdByName: me?.displayName || me?.email || "Your manager",
      code: payload.code,
      title: payload.title,
      description: payload.description,
      spec: { ...spec, title: payload.title },
      assigneeIds: assignees,
      viewerIds: viewers,
      graceHours: payload.graceHours,
      timeZone: payload.timeZone,
      status: "active",
      archivedAt: null,
      specRevision: 0,
      createdAt: now,
      updatedAt: now,
    };
    const col = await getAssignedGoalsCollection();
    await col.insertOne(doc);

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "assigned_goal.create",
      targetType: "assigned_goal",
      targetId: doc._id.toHexString(),
      after: { title: doc.title, assignees: assignees.length, viewers: viewers.length },
      ...networkMeta(req),
    });

    const id = doc._id.toHexString();
    notifyMany(session.orgId, session.userId, assignees, () => ({
      kind: "assigned_goal_assigned",
      title: `New shared goal: ${doc.title}`.slice(0, 200),
      body: `${doc.createdByName} shared "${doc.title}" with you. It's in your goals under "Shared goals".`,
      data: { assignedGoalId: id, goalId: assignedGoalId(id) },
    }));
    notifyMany(session.orgId, session.userId, viewers, () => ({
      kind: "assigned_goal_shared",
      title: `Shared with you: ${doc.title}`.slice(0, 200),
      body: `${doc.createdByName} gave you access to the progress of "${doc.title}".`,
      data: { assignedGoalId: id },
    }));

    res.status(201).json({ goal: await toPublic(doc, { withPeople: true }) });
  } catch (err) {
    next(err);
  }
}

// ─── GET /?scope= ────────────────────────────────────────────────────

export async function listAssignedGoalsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const session = requireSession(req);
    const { scope, includeArchived } = listQuerySchema.parse(req.query);
    const filter: Record<string, unknown> = { orgId: session.orgId };
    if (scope === "created") filter.createdBy = session.userId;
    else if (scope === "viewing") filter.viewerIds = session.userId;
    else filter.assigneeIds = session.userId;
    if (!includeArchived) filter.status = "active";

    const col = await getAssignedGoalsCollection();
    const docs = await col.find(filter).sort({ createdAt: -1 }).limit(200).toArray();

    // One inputs query for every listed goal → summary rates per goal.
    const inputs = await getGoalInputsCollection();
    const goalIds = docs.map((d) => assignedGoalId(d._id.toHexString()));
    const entries = goalIds.length
      ? await inputs
          .find(
            { orgId: session.orgId, goalId: { $in: goalIds } },
            { projection: { userId: 1, goalId: 1, ts: 1, createdAt: 1, value: 1 } },
          )
          .toArray()
      : [];
    const byGoal = new Map<string, typeof entries>();
    for (const e of entries) {
      const list = byGoal.get(e.goalId) ?? [];
      list.push(e);
      byGoal.set(e.goalId, list);
    }

    const goals = await Promise.all(
      docs.map(async (d) => {
        const gid = assignedGoalId(d._id.toHexString());
        // An assignee listing their own shared goals sees only their row.
        const scoped = scope === "assigned" ? [session.userId] : d.assigneeIds;
        const assigneeSet = new Set(scoped.map(String));
        const progress = buildProgress({
          spec: d.spec,
          graceHours: d.graceHours,
          timeZone: d.timeZone || DEFAULT_TIME_ZONE,
          users: scoped.map((id) => ({ id: String(id), displayName: "", email: null })),
          entries: (byGoal.get(gid) ?? [])
            .filter((e) => assigneeSet.has(String(e.userId)))
            .map((e) => ({ userId: String(e.userId), ts: e.ts, createdAt: e.createdAt, value: e.value })),
        });
        const current = progress.windows.find((w) => w.counts.open > 0) ?? null;
        return {
          ...(await toPublic(d)),
          totals: progress.totals,
          windowCount: progress.windows.length,
          currentWindow: current ? { label: current.label, deadline: current.deadline, counts: current.counts } : null,
        };
      }),
    );
    res.json({ goals });
  } catch (err) {
    next(err);
  }
}

// ─── GET /:id ────────────────────────────────────────────────────────

export async function getAssignedGoalHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const session = requireSession(req);
    const doc = await loadGoal(req, session.orgId);
    const uid = session.userId;
    if (canViewProgress(doc, uid)) {
      res.json({
        goal: await toPublic(doc, { withPeople: true }),
        role: isCreator(doc, uid) ? "creator" : "viewer",
      });
      return;
    }
    if (has(doc.assigneeIds, uid)) {
      res.json({ goal: await toPublic(doc), role: "assignee" });
      return;
    }
    notFound();
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /:id ──────────────────────────────────────────────────────

export async function patchAssignedGoalHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const session = requireSession(req);
    const doc = await loadGoal(req, session.orgId);
    if (!isCreator(doc, session.userId)) notFound();
    if (doc.status !== "active") {
      throw new HttpError(409, "assigned_goal_archived", "This shared goal is archived.");
    }
    const payload = patchAssignedGoalSchema.parse(req.body);
    const set: Partial<AssignedGoal> = { updatedAt: new Date() };
    if (payload.title !== undefined) set.title = payload.title;
    if (payload.code !== undefined) set.code = payload.code;
    if (payload.description !== undefined) set.description = payload.description;
    if (payload.graceHours !== undefined) set.graceHours = payload.graceHours;
    if (payload.timeZone !== undefined) set.timeZone = payload.timeZone;

    let structural = false;
    if (payload.spec !== undefined) {
      const spec = checkAssignableSpec(payload.spec);
      structural = isStructuralChange(doc.spec, spec);
      if (structural) {
        // Re-keying the periods after someone has filled one would orphan
        // their submissions and rewrite who was late.
        const inputs = await getGoalInputsCollection();
        const any = await inputs.findOne(
          { orgId: session.orgId, goalId: assignedGoalId(doc._id.toHexString()) },
          { projection: { _id: 1 } },
        );
        if (any && payload.confirmReschedule !== true) {
          throw new HttpError(
            409,
            "assigned_goal_reschedule_confirm",
            "People have already submitted to this goal. Changing its schedule (cadence, dates or number of periods) keeps their entries, but any that no longer fall in a period drop out of the grid. Confirm to go ahead.",
          );
        }
        set.specRevision = doc.specRevision + 1;
      }
      set.spec = { ...spec, title: set.title ?? doc.title };
    } else if (set.title) {
      set.spec = { ...doc.spec, title: set.title };
    }

    let added: ObjectId[] = [];
    let addedViewers: ObjectId[] = [];
    if (payload.assigneeIds !== undefined || payload.viewerIds !== undefined) {
      const { assignees, viewers } = await checkPeople(
        session.orgId,
        payload.assigneeIds ?? doc.assigneeIds.map(String),
        payload.viewerIds ?? doc.viewerIds.map(String),
        {
          assignees: new Set(doc.assigneeIds.map(String)),
          viewers: new Set(doc.viewerIds.map(String)),
        },
      );
      set.assigneeIds = assignees;
      set.viewerIds = viewers;
      added = assignees.filter((id) => !has(doc.assigneeIds, id));
      addedViewers = viewers.filter((id) => !has(doc.viewerIds, id));
    }

    const col = await getAssignedGoalsCollection();
    const updated = await col.findOneAndUpdate(
      { _id: doc._id, orgId: session.orgId },
      { $set: set },
      { returnDocument: "after" },
    );
    if (!updated) notFound();

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "assigned_goal.update",
      targetType: "assigned_goal",
      targetId: doc._id.toHexString(),
      after: { fields: Object.keys(payload), structural },
      ...networkMeta(req),
    });

    const id = doc._id.toHexString();
    notifyMany(session.orgId, session.userId, added, () => ({
      kind: "assigned_goal_assigned",
      title: `New shared goal: ${updated.title}`.slice(0, 200),
      body: `${updated.createdByName} shared "${updated.title}" with you. It's in your goals under "Shared goals".`,
      data: { assignedGoalId: id, goalId: assignedGoalId(id) },
    }));
    notifyMany(session.orgId, session.userId, addedViewers, () => ({
      kind: "assigned_goal_shared",
      title: `Shared with you: ${updated.title}`.slice(0, 200),
      body: `${updated.createdByName} gave you access to the progress of "${updated.title}".`,
      data: { assignedGoalId: id },
    }));
    if (payload.spec !== undefined) {
      const existing = updated.assigneeIds.filter((a) => !has(added, a));
      notifyMany(session.orgId, session.userId, existing, () => ({
        kind: "assigned_goal_updated",
        title: `Shared goal updated: ${updated.title}`.slice(0, 200),
        body: `${updated.createdByName} changed the plan for "${updated.title}".`,
        data: { assignedGoalId: id, goalId: assignedGoalId(id) },
      }));
    }

    res.json({ goal: await toPublic(updated, { withPeople: true }) });
  } catch (err) {
    next(err);
  }
}

// ─── POST /:id/archive ───────────────────────────────────────────────

export async function archiveAssignedGoalHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const session = requireSession(req);
    const doc = await loadGoal(req, session.orgId);
    if (!isCreator(doc, session.userId)) notFound();
    const now = new Date();
    const col = await getAssignedGoalsCollection();
    const updated = await col.findOneAndUpdate(
      { _id: doc._id, orgId: session.orgId },
      { $set: { status: "archived", archivedAt: now, updatedAt: now } },
      { returnDocument: "after" },
    );
    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "assigned_goal.archive",
      targetType: "assigned_goal",
      targetId: doc._id.toHexString(),
      ...networkMeta(req),
    });
    res.json({ goal: await toPublic(updated ?? doc) });
  } catch (err) {
    next(err);
  }
}

// ─── GET /:id/progress ───────────────────────────────────────────────

export async function getProgressHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const session = requireSession(req);
    const doc = await loadGoal(req, session.orgId);
    if (!canViewProgress(doc, session.userId)) notFound();

    const inputs = await getGoalInputsCollection();
    const entries = await inputs
      .find(
        {
          orgId: session.orgId,
          userId: { $in: doc.assigneeIds },
          goalId: assignedGoalId(doc._id.toHexString()),
        },
        { projection: { userId: 1, ts: 1, createdAt: 1, value: 1 } },
      )
      .toArray();
    const people = await resolvePeopleAnyStatus(session.orgId, doc.assigneeIds.map(String));
    const gid = assignedGoalId(doc._id.toHexString());
    const verdictRows = await (await getManagerGoalVerdictsCollection())
      .find({ orgId: session.orgId, goalId: gid, subjectUserId: { $in: doc.assigneeIds } })
      .toArray();
    const verdicts = Object.fromEntries(
      verdictRows.map((v) => [
        String(v.subjectUserId),
        {
          tier: v.tier,
          note: v.note,
          gradedByName: v.gradedByName,
          gradedAt: v.gradedAt.toISOString(),
        },
      ]),
    );
    const progress = buildProgress({
      spec: doc.spec,
      graceHours: doc.graceHours,
      timeZone: doc.timeZone || DEFAULT_TIME_ZONE,
      users: doc.assigneeIds.map((id) => publicUser(people.get(String(id)), String(id))),
      entries: entries.map((e) => ({
        userId: String(e.userId),
        ts: e.ts,
        createdAt: e.createdAt,
        value: e.value,
      })),
    });
    res.json({
      goal: await toPublic(doc, { withPeople: true }),
      role: isCreator(doc, session.userId) ? "creator" : "viewer",
      generatedAt: new Date().toISOString(),
      ...progress,
      verdicts,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /:id/progress/:userId/:periodKey ────────────────────────────

/**
 * The values behind one grid cell. `periodKey` is the window key, or `once`
 * for a one-time plan's single window.
 */
export async function getProgressCellHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const session = requireSession(req);
    const doc = await loadGoal(req, session.orgId);
    if (!canViewProgress(doc, session.userId)) notFound();
    const { userId, periodKey } = req.params;
    if (typeof userId !== "string" || !ObjectId.isValid(userId)) notFound();
    const subject = new ObjectId(userId);
    if (!has(doc.assigneeIds, subject)) notFound();

    const progressWindows = buildProgress({
      spec: doc.spec,
      graceHours: doc.graceHours,
      timeZone: doc.timeZone || DEFAULT_TIME_ZONE,
      users: [],
      entries: [],
    }).windows;
    const key = periodKey === "once" ? null : periodKey;
    const index = progressWindows.findIndex((w) => w.key === key);
    if (index < 0) notFound();
    const w = progressWindows[index];

    const inputs = await getGoalInputsCollection();
    const rows = await inputs
      .find({
        orgId: session.orgId,
        userId: subject,
        goalId: assignedGoalId(doc._id.toHexString()),
      })
      .sort({ createdAt: 1, _id: 1 })
      .toArray();
    const inWindow = rows.filter((e) => {
      const pk = (e.value as Record<string, unknown> | null)?.periodKey;
      if (typeof pk === "string" && pk) return key != null && pk === key;
      if (key == null) return true;
      const ts = e.ts.getTime();
      return ts >= w.start && ts < w.end;
    });
    const at = (e: (typeof rows)[number]) => (e.createdAt ?? e.ts).toISOString();
    const latest = inWindow[inWindow.length - 1] ?? null;
    const latestValue = (latest?.value ?? null) as Record<string, unknown> | null;
    const people = await resolvePeopleAnyStatus(session.orgId, [userId]);

    res.json({
      user: publicUser(people.get(userId), userId),
      window: { key: w.key, label: w.label, deadline: w.deadline },
      entryCount: inWindow.length,
      submittedAt: inWindow[0] ? at(inWindow[0]) : null,
      lastEditedAt: latest ? at(latest) : null,
      approx: inWindow.some((e) => !e.createdAt),
      values: (latestValue?.values as Record<string, unknown>) ?? {},
      evidence: (latestValue?.evidence as Record<string, unknown>) ?? {},
      note: latest?.note ?? null,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /:id/mine ───────────────────────────────────────────────────

/**
 * An assignee's own period statuses on one shared goal — also after it's
 * archived, so "Past cycles" can still show how they did.
 */
export async function getMyProgressHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const session = requireSession(req);
    const doc = await loadGoal(req, session.orgId);
    if (!has(doc.assigneeIds, session.userId)) notFound();
    const inputs = await getGoalInputsCollection();
    const gid = assignedGoalId(doc._id.toHexString());
    const entries = await inputs
      .find(
        { orgId: session.orgId, userId: session.userId, goalId: gid },
        { projection: { ts: 1, createdAt: 1, value: 1 } },
      )
      .toArray();
    const progress = buildProgress({
      spec: doc.spec,
      graceHours: doc.graceHours,
      timeZone: doc.timeZone || DEFAULT_TIME_ZONE,
      users: [{ id: String(session.userId), displayName: "", email: null }],
      entries: entries.map((e) => ({
        userId: String(session.userId),
        ts: e.ts,
        createdAt: e.createdAt,
        value: e.value,
      })),
    });
    const verdict = await (await getManagerGoalVerdictsCollection()).findOne({
      orgId: session.orgId,
      goalId: gid,
      subjectUserId: session.userId,
    });
    res.json({
      goal: await toPublic(doc),
      windows: progress.windows.map(({ counts: _c, ...w }) => w),
      cells: progress.rows[0]?.cells ?? [],
      summary: progress.rows[0]?.summary ?? null,
      verdict: verdict
        ? { tier: verdict.tier, note: verdict.note, gradedByName: verdict.gradedByName }
        : null,
    });
  } catch (err) {
    next(err);
  }
}

// ─── PUT /:id/verdicts/:userId ───────────────────────────────────────

const TIER_LABEL: Record<string, string> = {
  not_achieved: "Not achieved",
  achieved: "Achieved",
  over_achieved: "Over achieved",
  role_model: "Role model",
};

/**
 * The creator grades an assignee on the shared goal — a manager verdict of
 * record, same collection the line manager's board writes, so whichever
 * grade was set last wins and both surfaces show it.
 */
export async function putVerdictHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const session = requireSession(req);
    const doc = await loadGoal(req, session.orgId);
    if (!isCreator(doc, session.userId)) notFound();
    const { userId } = req.params;
    if (typeof userId !== "string" || !ObjectId.isValid(userId)) notFound();
    const subject = new ObjectId(userId);
    if (!has(doc.assigneeIds, subject)) notFound();
    const { tier, note } = verdictSchema.parse(req.body);

    const gid = assignedGoalId(doc._id.toHexString());
    await upsertManagerVerdict({
      orgId: session.orgId,
      subjectUserId: subject,
      goalId: gid,
      tier,
      note,
      gradedBy: session.userId,
      gradedByName: doc.createdByName,
    });
    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "assigned_goal.verdict.set",
      targetType: "goal",
      targetId: gid,
      after: { subjectUserId: userId, tier, hasNote: note.length > 0 },
      ...networkMeta(req),
    });
    void createNotification({
      orgId: session.orgId,
      userId: subject,
      kind: "manager_graded",
      title: "A shared goal was graded",
      body: `${doc.createdByName} set "${doc.title}" to ${TIER_LABEL[tier]}.`,
      data: { goalId: gid, tier, goalTitle: doc.title, gradedByName: doc.createdByName, note },
      createdBy: session.userId,
    });
    res.json({ ok: true, verdict: { tier, note, gradedByName: doc.createdByName } });
  } catch (err) {
    next(err);
  }
}

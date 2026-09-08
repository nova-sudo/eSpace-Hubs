/**
 * "My reports" — the minimal read a team lead needs from inside their own
 * development plan, without being in the Manager hub.
 *
 * AUTHORIZATION IS THE RELATIONSHIP ITSELF. Every query here is scoped to
 * `managerId === session.userId`, and that scoping is the *only* thing that
 * grants access: no capability, no role, no self-declared list. A user typing
 * an email address into their plan learns whether that person is already
 * assigned to them and nothing else — the resolve endpoint returns names for
 * people who are, and a flat "not linked" for everyone else, whether they
 * exist or not. Admin assignment stays the one way the link gets made.
 *
 * Why not the manager module: those routes require MANAGER_TEAM_VIEW, which a
 * dev-hub team lead usually doesn't hold. This is a deliberately smaller
 * surface — who reports to me, and what have they filled in — rather than a
 * back door into the manager hub's richer reads.
 *
 * WHAT IT DELIBERATELY DOESN'T DO: derive "owed". Owed-ness comes from the
 * cadence-window engine that lives in apps/web (goal-inputs/cadence-windows.js)
 * and needs client-local window state; this hands back the raw filled period
 * keys and lets the caller's existing engine do that maths, rather than
 * shipping a second implementation that can disagree with the first.
 */

import type { NextFunction, Request, Response } from "express";
import type { ObjectId } from "mongodb";
import { z } from "zod";
import {
  getGoalInputsCollection,
  getGoalSpecsCollection,
  getGoalsCollection,
  getUsersCollection,
} from "../../db/collections.js";
import { HttpError } from "../../middleware/error-handler.js";

/**
 * A lead with more than this many direct reports is not the case this view
 * was built for, and the payload stops being "minimal" well before it.
 */
const MAX_REPORTS = 25;

/** Per report. A year of weekly windows across a handful of goals fits easily. */
const MAX_ENTRIES_PER_REPORT = 400;

interface PublicReport {
  id: string;
  name: string;
  email: string;
}

function requireSession(req: Request) {
  const session = req.session;
  if (!session) throw new HttpError(401, "unauthenticated", "Login required.");
  return session;
}

async function myReports(
  managerId: ObjectId,
  orgId: ObjectId,
): Promise<Array<{ _id: ObjectId; name: string; email: string }>> {
  const users = await getUsersCollection();
  const rows = await users
    .find({ orgId, managerId, status: { $ne: "disabled" } })
    .limit(MAX_REPORTS)
    .toArray();
  return rows.map((u) => ({
    _id: u._id,
    name: u.displayName || u.email,
    email: u.email,
  }));
}

// ─── GET /api/v1/my-reports ──────────────────────────────────────────

export async function listMyReportsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = requireSession(req);
    const rows = await myReports(session.userId, session.orgId);
    res.json({
      reports: rows.map((r) => ({
        id: r._id.toHexString(),
        name: r.name,
        email: r.email,
      })) satisfies PublicReport[],
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/v1/my-reports/resolve ─────────────────────────────────

const resolveSchema = z.object({
  emails: z.array(z.string().min(3).max(320)).min(1).max(MAX_REPORTS),
});

/**
 * The plan's tiny onboarding: "who do you manage?" Each address comes back
 * either as a linked report or in `unlinked`.
 *
 * `unlinked` deliberately does NOT distinguish "no such user" from "exists but
 * reports to someone else" — that difference would turn this into an org
 * directory oracle for anyone with an email address to guess. The copy the
 * client shows for it points at an admin, which is the only route to a link.
 */
export async function resolveMyReportsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = requireSession(req);
    const { emails } = resolveSchema.parse(req.body);
    const wanted = emails.map((e) => e.trim().toLowerCase()).filter(Boolean);

    const linked = (await myReports(session.userId, session.orgId)).filter((r) =>
      wanted.includes(r.email.toLowerCase()),
    );
    const linkedEmails = new Set(linked.map((r) => r.email.toLowerCase()));

    res.json({
      linked: linked.map((r) => ({
        id: r._id.toHexString(),
        name: r.name,
        email: r.email,
      })) satisfies PublicReport[],
      unlinked: wanted.filter((e) => !linkedEmails.has(e)),
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/v1/my-reports/fills ────────────────────────────────────

interface ReportGoalFill {
  goalId: string;
  title: string;
  cadence: string | null;
  /** Distinct period keys this report has logged something against. */
  filled: string[];
  /** Epoch ms of their most recent entry on this goal, or null. */
  lastAt: number | null;
}

/**
 * What each report has actually filled in. One request for the whole team —
 * a per-report fan-out from the browser is the pattern #238 already replaced
 * once on the manager board.
 */
export async function listReportFillsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = requireSession(req);
    const reports = await myReports(session.userId, session.orgId);
    if (reports.length === 0) {
      res.json({ reports: [] });
      return;
    }
    const ids = reports.map((r) => r._id);

    // Every read carries orgId as well as the report ids — the ids already
    // came from an org-scoped query, but a filter that stands on its own is
    // one less thing to get wrong if this ever grows a second caller.
    const [goalDocs, specDocs, inputs] = await Promise.all([
      (await getGoalsCollection())
        .find({ orgId: session.orgId, userId: { $in: ids } })
        .toArray(),
      (await getGoalSpecsCollection())
        .find({ orgId: session.orgId, userId: { $in: ids } })
        .toArray(),
      (await getGoalInputsCollection())
        .find({ orgId: session.orgId, userId: { $in: ids } })
        .sort({ ts: -1 })
        .limit(MAX_ENTRIES_PER_REPORT * reports.length)
        .toArray(),
    ]);

    // goalId → title, per user. The goals tree shape is {l1s:[{l2s:[]}]}, so
    // both levels are walked; a goal with no spec never appears below anyway.
    const titles = new Map<string, string>();
    for (const doc of goalDocs as Array<Record<string, unknown>>) {
      const l1s = Array.isArray(doc.l1s) ? doc.l1s : [];
      for (const l1 of l1s as Array<Record<string, unknown>>) {
        if (typeof l1.id === "string") titles.set(l1.id, String(l1.title ?? ""));
        const l2s = Array.isArray(l1.l2s) ? l1.l2s : [];
        for (const l2 of l2s as Array<Record<string, unknown>>) {
          if (typeof l2.id === "string") titles.set(l2.id, String(l2.title ?? ""));
        }
      }
    }

    const cadenceOf = new Map<string, string | null>();
    for (const s of specDocs as Array<Record<string, unknown>>) {
      const goalId = String(s.goalId ?? "");
      if (!goalId) continue;
      const spec = (s.spec ?? {}) as Record<string, unknown>;
      const manual = (spec.manual ?? {}) as Record<string, unknown>;
      const composed = (spec.composed ?? {}) as Record<string, unknown>;
      const cadence =
        (typeof manual.cadence === "string" ? manual.cadence : null) ??
        (typeof composed.cadence === "string" ? composed.cadence : null);
      cadenceOf.set(goalId, cadence);
    }

    // userId → goalId → {filled, lastAt}
    const byUser = new Map<string, Map<string, ReportGoalFill>>();
    for (const row of inputs as Array<Record<string, unknown>>) {
      const uid = (row.userId as ObjectId).toHexString();
      const goalId = String(row.goalId ?? "");
      if (!goalId) continue;
      if (!byUser.has(uid)) byUser.set(uid, new Map());
      const goals = byUser.get(uid)!;
      if (!goals.has(goalId)) {
        goals.set(goalId, {
          goalId,
          title: titles.get(goalId) || goalId,
          cadence: cadenceOf.get(goalId) ?? null,
          filled: [],
          lastAt: null,
        });
      }
      const entry = goals.get(goalId)!;
      // The period key lives inside the polymorphic value for period-bucketed
      // widgets; a widget with no periods logs one running record instead.
      const value = (row.value ?? {}) as Record<string, unknown>;
      const periodKey =
        typeof value.periodKey === "string" && value.periodKey ? value.periodKey : null;
      if (periodKey && !entry.filled.includes(periodKey)) entry.filled.push(periodKey);
      const ts = row.ts instanceof Date ? row.ts.getTime() : null;
      if (ts && (entry.lastAt === null || ts > entry.lastAt)) entry.lastAt = ts;
    }

    res.json({
      reports: reports.map((r) => {
        const uid = r._id.toHexString();
        const goals = [...(byUser.get(uid)?.values() ?? [])];
        return {
          id: uid,
          name: r.name,
          email: r.email,
          goals,
          lastAt: goals.reduce<number | null>(
            (acc, g) => (g.lastAt && (acc === null || g.lastAt > acc) ? g.lastAt : acc),
            null,
          ),
        };
      }),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Thin handlers for /api/v1/github-links. The flows live in publish.ts
 * and sync.ts with injected deps; this file wires the real collection,
 * the user's decrypted GitHub token, the audit log and the notifier, and
 * shapes rows for the client.
 *
 * Nothing here ever returns the idempotency key, the token, or an
 * upstream body. `toPublic` is the ONLY shape a browser sees.
 */

import type { NextFunction, Request, Response } from "express";
import { ObjectId } from "mongodb";
import { isAssignedGoalId, parseAssignedGoalId } from "@espace-devhub/shared/goal-specs";
import { getDb } from "../../db/client.js";
import {
  getAssignedGoalsCollection,
  getEvidenceCollection,
  getGithubLinksCollection,
  getGoalInputsCollection,
  getGoalSpecsCollection,
  getGoalsCollection,
  getGoalTierVerdictsCollection,
  getManagerGoalVerdictEventsCollection,
  getManagerGoalVerdictsCollection,
  getManagerReportNotesCollection,
  getUsersCollection,
} from "../../db/collections.js";
import type { GithubLink, GithubLinkState, Session } from "../../db/types.js";
import { assignedSpecFor, requireActiveAssignee } from "../../lib/assigned-goals.js";
import { verdictPeriodKey } from "../../lib/manager-verdicts.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { createNotification } from "../../lib/notifications.js";
import { HttpError } from "../../middleware/error-handler.js";
import {
  loadDecryptedTokens,
  markIntegrationError,
  markIntegrationUsed,
} from "../integrations/controller.js";
import { resolveReportFor } from "../manager/resolve-report.js";
import { loadLinkForViewer, postLinkComment, type CommentDeps } from "./comments.js";
import {
  buildCorrelation,
  type CorrelationEntry,
  type CorrelationGoal,
  type CorrelationGoalInput,
  type CorrelationVerdict,
} from "./correlation.js";
import { createGithubClient, type GithubClient } from "./github-client.js";
import {
  hubGoalsUrl,
  publishGoalToGithub,
  resolvePublishTarget,
  type PublishOutcome,
} from "./publish.js";
import {
  commentPostSchema,
  linkIdSchema,
  manifestsQuerySchema,
  optionalGoalQuerySchema,
  publishSchema,
  syncSchema,
} from "./schemas.js";
import { resolveOwnerName, resolveReadingRecipients, syncLink, type SyncDeps } from "./sync.js";

const GITHUB_PROVIDER = "github";
const SYNC_SPACING_MS = 300;
const LIVE_STATUSES = ["pending", "linked", "failed"] as const;
/** Cap on an all-goals read (GET without goalId). */
const MAX_ALL_LINKS = 500;

// ─── public shape ────────────────────────────────────────────────────

export interface PublicLinkState {
  issueState: "open" | "closed" | "missing";
  stateReason: string | null;
  closedAt: string | null;
  updatedAt: string | null;
  title: string;
  tasks: { done: number; total: number };
  labels: string[];
  assignees: string[];
  commentsCount: number;
  linkedPrs: Array<{
    repo: string;
    number: number;
    prId: number;
    url: string;
    title: string;
    state: "open" | "closed" | "merged";
    mergedAt: string | null;
    author: string | null;
  }>;
  comments: Array<{
    commentId: number;
    author: string;
    body: string;
    createdAt: string;
    url: string;
  }>;
}

export interface PublicLink {
  id: string;
  goalId: string;
  periodIndex: number;
  periodKey: string | null;
  periodLabel: string;
  repo: string;
  issueNumber: number | null;
  issueUrl: string | null;
  status: GithubLink["status"];
  state: PublicLinkState | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  syncFailures: number;
  readingWritten: boolean;
  stale: boolean;
  posts: Array<{ kind: string; sourceId: string; commentId: number; postedAt: string }>;
}

const iso = (d: Date | null | undefined): string | null =>
  d instanceof Date ? d.toISOString() : null;

function publicState(state: GithubLinkState | null): PublicLinkState | null {
  if (!state) return null;
  return {
    issueState: state.issueState,
    stateReason: state.stateReason ?? null,
    closedAt: iso(state.closedAt),
    updatedAt: iso(state.updatedAt),
    title: state.title,
    tasks: { done: state.tasks.done, total: state.tasks.total },
    labels: state.labels ?? [],
    assignees: state.assignees ?? [],
    commentsCount: state.commentsCount ?? 0,
    linkedPrs: (state.linkedPrs ?? []).map((p) => ({
      repo: p.repo,
      number: p.number,
      prId: p.prId,
      url: p.url,
      title: p.title,
      state: p.state,
      mergedAt: iso(p.mergedAt),
      author: p.author ?? null,
    })),
    comments: (state.comments ?? []).map((c) => ({
      commentId: c.commentId,
      author: c.author,
      body: c.body,
      createdAt: iso(c.createdAt) ?? "",
      url: c.url,
    })),
  };
}

export function toPublic(link: GithubLink): PublicLink {
  return {
    id: link._id.toHexString(),
    goalId: link.goalId,
    periodIndex: link.periodIndex,
    periodKey: link.periodKey ?? null,
    periodLabel: link.periodLabel,
    repo: link.repo,
    issueNumber: link.issueNumber ?? null,
    issueUrl: link.issueUrl ?? null,
    status: link.status,
    state: publicState(link.state),
    lastSyncedAt: iso(link.lastSyncedAt),
    lastSyncError: link.lastSyncError ?? null,
    syncFailures: link.syncFailures ?? 0,
    readingWritten: link.readingInputId != null,
    stale: Boolean(link.stale),
    posts: (link.posts ?? []).map((p) => ({
      kind: p.kind,
      sourceId: p.sourceId,
      commentId: p.commentId,
      postedAt: iso(p.postedAt) ?? "",
    })),
  };
}

// ─── wiring ──────────────────────────────────────────────────────────

function requireSession(req: Request): Session {
  const session = req.session;
  if (!session) throw new HttpError(401, "unauthenticated", "Login required.");
  return session;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** The caller's GitHub client, from their stored token. 400 when not connected. */
async function clientFor(session: Pick<Session, "orgId" | "userId">): Promise<GithubClient> {
  const tokens = await loadDecryptedTokens({
    orgId: session.orgId,
    userId: session.userId,
    providerId: GITHUB_PROVIDER,
  });
  if (!tokens?.accessToken) {
    throw new HttpError(
      400,
      "integration_not_connected",
      "Connect GitHub in settings before publishing.",
    );
  }
  return createGithubClient({ token: tokens.accessToken });
}

function markErrorFor(session: Pick<Session, "orgId" | "userId">) {
  return (message: string): Promise<void> =>
    markIntegrationError({
      orgId: session.orgId,
      userId: session.userId,
      providerId: GITHUB_PROVIDER,
      message,
    });
}

/** A user's live links for one goal, or — without a goalId — all of them (capped). */
async function liveLinks(
  orgId: ObjectId,
  userId: ObjectId,
  goalId: string | undefined,
): Promise<GithubLink[]> {
  const col = await getGithubLinksCollection();
  if (goalId === undefined) {
    return col
      .find({ orgId, userId, status: { $in: [...LIVE_STATUSES] } })
      .sort({ goalId: 1, periodIndex: 1 })
      .limit(MAX_ALL_LINKS)
      .toArray();
  }
  return col
    .find({ orgId, userId, goalId, status: { $in: [...LIVE_STATUSES] } })
    .sort({ periodIndex: 1 })
    .toArray();
}

async function ownedLink(session: Session, rawId: unknown): Promise<GithubLink> {
  const parsed = linkIdSchema.safeParse(rawId);
  if (!parsed.success) {
    throw new HttpError(404, "not_found", "No such link.");
  }
  const col = await getGithubLinksCollection();
  const link = await col.findOne({
    _id: new ObjectId(parsed.data),
    orgId: session.orgId,
    userId: session.userId,
  });
  if (!link || link.status === "unlinked") {
    throw new HttpError(404, "not_found", "No such link.");
  }
  return link;
}

async function softUnlink(link: GithubLink, now: Date): Promise<void> {
  const col = await getGithubLinksCollection();
  await col.updateOne(
    { _id: link._id, status: { $ne: "unlinked" } },
    {
      $set: {
        status: "unlinked",
        unlinkedAt: now,
        // Frees the unique claim so the period can be published again.
        idempotencyKey: `${link.idempotencyKey}|unlinked|${now.getTime()}`,
      },
    },
  );
}

async function runPublish(
  req: Request,
  session: Session,
  goalId: string,
  repo: string,
  periodIndexes: number[] | undefined,
): Promise<PublishOutcome> {
  const target = await resolvePublishTarget(session.orgId, session.userId, goalId);
  const client = await clientFor(session);
  const users = await getUsersCollection();
  const me = await users.findOne(
    { _id: session.userId },
    { projection: { displayName: 1, email: 1 } },
  );
  const { ip, ua } = networkMeta(req);
  const outcome = await publishGoalToGithub(
    {
      links: await getGithubLinksCollection(),
      client,
      now: () => new Date(),
      sleep,
      audit: writeAudit,
      notify: createNotification,
      markError: markErrorFor(session),
      hubUrl: hubGoalsUrl(),
    },
    {
      orgId: session.orgId,
      userId: session.userId,
      actorRole: session.role,
      actorName: me?.displayName || me?.email || null,
      goalId,
      repo,
      periodIndexes,
      target,
      ip,
      ua,
    },
  );
  if (outcome.created + outcome.adopted > 0) {
    void markIntegrationUsed({
      orgId: session.orgId,
      userId: session.userId,
      providerId: GITHUB_PROVIDER,
    });
  }
  return outcome;
}

// ─── handlers ────────────────────────────────────────────────────────

/** POST /github-links/publish */
export async function publishHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = requireSession(req);
    const { goalId, repo, periodIndexes } = publishSchema.parse(req.body);
    const outcome = await runPublish(req, session, goalId, repo, periodIndexes);
    res.status(201).json({
      links: outcome.links.map(toPublic),
      created: outcome.created,
      adopted: outcome.adopted,
      skipped: outcome.skipped,
      remaining: outcome.remaining,
      ...(outcome.retryAfterMs !== undefined ? { retryAfterMs: outcome.retryAfterMs } : {}),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /github-links?goalId= — the stored snapshot, no provider call.
 * Without `goalId`: every live link of the caller (≤ 500), for surfaces
 * that list across goals (the evidence page's "Linked on GitHub").
 */
export async function listHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = requireSession(req);
    const { goalId } = optionalGoalQuerySchema.parse(req.query);
    const links = await liveLinks(session.orgId, session.userId, goalId);
    res.json({ links: links.map(toPublic) });
  } catch (err) {
    next(err);
  }
}

/** GET /github-links/manifests?goalIds=a,b,c */
export async function manifestsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = requireSession(req);
    const { goalIds } = manifestsQuerySchema.parse(req.query);
    const col = await getGithubLinksCollection();
    const rows = await col
      .find({
        orgId: session.orgId,
        userId: session.userId,
        goalId: { $in: goalIds },
        status: { $in: [...LIVE_STATUSES] },
      })
      .sort({ goalId: 1, periodIndex: 1 })
      .toArray();
    const byGoal: Record<string, PublicLink[]> = {};
    for (const id of goalIds) byGoal[id] = [];
    for (const row of rows) (byGoal[row.goalId] ??= []).push(toPublic(row));
    res.json({ byGoal });
  } catch (err) {
    next(err);
  }
}

/** POST /github-links/sync — refresh every linked period of one goal. */
export async function syncHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = requireSession(req);
    const { goalId } = syncSchema.parse(req.body);
    if (isAssignedGoalId(goalId)) {
      await requireActiveAssignee(session.orgId, session.userId, goalId);
    }
    const col = await getGithubLinksCollection();
    const linked = (await liveLinks(session.orgId, session.userId, goalId)).filter(
      (l) => l.status === "linked",
    );
    const errors: Record<string, { code: string; message: string }> = {};
    let readingsWritten = 0;

    if (linked.length > 0) {
      // A manual sync is a fresh start: the scheduler's skip-at-3 counter
      // must not keep a link the user just asked about from being read.
      await col.updateMany(
        { _id: { $in: linked.map((l) => l._id) } },
        { $set: { syncFailures: 0 } },
      );
      const deps: SyncDeps = {
        links: col,
        inputs: await getGoalInputsCollection(),
        client: await clientFor(session),
        now: () => new Date(),
        audit: writeAudit,
        notify: createNotification,
        markError: markErrorFor(session),
        recipients: resolveReadingRecipients,
        ownerName: resolveOwnerName,
      };
      for (let i = 0; i < linked.length; i += 1) {
        const link = { ...(linked[i] as GithubLink), syncFailures: 0 };
        if (i > 0) await sleep(SYNC_SPACING_MS);
        try {
          const result = await syncLink(deps, link);
          if (result.readingWritten) readingsWritten += 1;
          if (result.error) errors[link._id.toHexString()] = result.error;
        } catch (err) {
          if (err instanceof HttpError && err.status === 429) {
            for (const rest of linked.slice(i)) {
              errors[rest._id.toHexString()] = { code: "rate_limited", message: err.message };
            }
            break;
          }
          throw err;
        }
      }
      void markIntegrationUsed({
        orgId: session.orgId,
        userId: session.userId,
        providerId: GITHUB_PROVIDER,
      });
    }

    const links = await liveLinks(session.orgId, session.userId, goalId);
    res.json({ links: links.map(toPublic), readingsWritten, errors });
  } catch (err) {
    next(err);
  }
}

/** POST /github-links/:linkId/republish — unlink, then publish that period again. */
export async function republishHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = requireSession(req);
    const link = await ownedLink(session, req.params.linkId);
    const now = new Date();
    await softUnlink(link, now);
    const { ip, ua } = networkMeta(req);
    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "github_links.republish",
      targetType: "github_link",
      targetId: link._id.toHexString(),
      before: { goalId: link.goalId, periodIndex: link.periodIndex, issueNumber: link.issueNumber },
      ip,
      ua,
    });
    const outcome = await runPublish(req, session, link.goalId, link.repo, [link.periodIndex]);
    const fresh = outcome.links.find((l) => l.periodIndex === link.periodIndex);
    if (!fresh) {
      throw new HttpError(
        502,
        "github_upstream_error",
        "The period couldn't be published again. Try again shortly.",
      );
    }
    res.json({ link: toPublic(fresh) });
  } catch (err) {
    next(err);
  }
}

/** DELETE /github-links/:linkId — soft unlink; GitHub is never touched. */
export async function unlinkHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = requireSession(req);
    const link = await ownedLink(session, req.params.linkId);
    await softUnlink(link, new Date());
    const { ip, ua } = networkMeta(req);
    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "github_links.unlink",
      targetType: "github_link",
      targetId: link._id.toHexString(),
      before: { goalId: link.goalId, periodIndex: link.periodIndex, issueNumber: link.issueNumber },
      ip,
      ua,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /manager/reports/:userId/github-links?goalId= — a report's links for
 * one goal (or, without goalId, all of them, ≤ 500), behind the same resolveReport boundary as every other
 * per-report manager read (404 unless the user is the caller's active
 * direct report).
 */
export async function listReportGithubLinksHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const users = await getUsersCollection();
    const target = await resolveReportFor(req.session, req.params.userId, (q) =>
      users.findOne(q),
    );
    const session = requireSession(req);
    const { goalId } = optionalGoalQuerySchema.parse(req.query);
    const links = await liveLinks(session.orgId, target._id, goalId);
    res.json({ links: links.map(toPublic) });
  } catch (err) {
    next(err);
  }
}

// ─── comments (Phase 3) ──────────────────────────────────────────────

async function commentDeps(): Promise<CommentDeps> {
  const [links, notes, verdictEvents, users, assigned] = await Promise.all([
    getGithubLinksCollection(),
    getManagerReportNotesCollection(),
    getManagerGoalVerdictEventsCollection(),
    getUsersCollection(),
    getAssignedGoalsCollection(),
  ]);
  return {
    links,
    notes,
    verdictEvents,
    findUser: (q) => users.findOne(q),
    findAssignedGoal: (q) => assigned.findOne(q, { projection: { createdBy: 1 } }),
    clientFor: async (session) => {
      const tokens = await loadDecryptedTokens({
        orgId: session.orgId,
        userId: session.userId,
        providerId: GITHUB_PROVIDER,
      });
      if (!tokens?.accessToken) {
        throw new HttpError(
          400,
          "integration_not_connected",
          "Connect GitHub in settings to post on the issue.",
        );
      }
      return createGithubClient({ token: tokens.accessToken });
    },
    now: () => new Date(),
    audit: writeAudit,
  };
}

/**
 * GET /github-links/:linkId/comments — the mirrored developer replies and
 * eSpace's own posts. Owner, their manager, or the shared goal's creator.
 */
export async function listCommentsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = requireSession(req);
    const { link } = await loadLinkForViewer(await commentDeps(), session, req.params.linkId, {
      allowOwner: true,
    });
    const pub = toPublic(link);
    res.json({ comments: pub.state?.comments ?? [], posts: pub.posts });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /github-links/:linkId/comments { kind, sourceId } — post a shared
 * 1:1 note or a tier verdict on the issue, composed server-side, with the
 * caller's own token. Idempotent per (link, kind, sourceId): a repeat
 * returns the recorded post without touching GitHub.
 */
export async function postCommentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = requireSession(req);
    const { kind, sourceId } = commentPostSchema.parse(req.body);
    const { ip, ua } = networkMeta(req);
    const out = await postLinkComment(await commentDeps(), session, {
      linkId: req.params.linkId,
      kind,
      sourceId,
      ip,
      ua,
    });
    if (!out.existing) {
      void markIntegrationUsed({
        orgId: session.orgId,
        userId: session.userId,
        providerId: GITHUB_PROVIDER,
      });
    }
    const post = toPublic(out.link).posts.find(
      (p) => p.kind === out.post.kind && p.sourceId === out.post.sourceId,
    );
    res.status(out.existing ? 200 : 201).json({ post, existing: out.existing });
  } catch (err) {
    next(err);
  }
}

// ─── correlation report (Phase 4) ────────────────────────────────────

/** Newest goal_inputs rows read per correlation request (all goals together). */
const MAX_CORRELATION_INPUTS = 5_000;

/** Title, code and spec for each linked goal — own (goal_specs + tree) or shared. */
async function correlationGoals(
  orgId: ObjectId,
  userId: ObjectId,
  goalIds: string[],
): Promise<CorrelationGoalInput[]> {
  const own = goalIds.filter((id) => !isAssignedGoalId(id));
  const shared = goalIds.filter((id) => isAssignedGoalId(id));
  const out = new Map<string, CorrelationGoalInput>();

  if (own.length > 0) {
    const [specRows, tree] = await Promise.all([
      (await getGoalSpecsCollection())
        .find({ orgId, userId, goalId: { $in: own } }, { projection: { goalId: 1, spec: 1 } })
        .toArray(),
      (await getGoalsCollection()).findOne({ orgId, userId }),
    ]);
    const l2s = new Map<string, { title: string; code: string | null }>();
    for (const l1 of tree?.l1s ?? []) {
      for (const l2 of l1.l2s ?? []) l2s.set(l2.id, { title: l2.title || "", code: l2.code || null });
    }
    const specs = new Map(specRows.map((r) => [r.goalId, r.spec as Record<string, unknown>]));
    for (const id of own) {
      const spec = specs.get(id) ?? null;
      const specTitle = (spec as { title?: unknown } | null)?.title;
      out.set(id, {
        goalId: id,
        title: l2s.get(id)?.title || (typeof specTitle === "string" ? specTitle : "") || "Goal",
        code: l2s.get(id)?.code ?? null,
        spec,
      });
    }
  }

  if (shared.length > 0) {
    const hexes = shared.map((id) => parseAssignedGoalId(id)).filter((h): h is string => Boolean(h));
    const docs = hexes.length
      ? await (await getAssignedGoalsCollection())
          .find({ _id: { $in: hexes.map((h) => new ObjectId(h)) }, orgId, assigneeIds: userId })
          .toArray()
      : [];
    const byHex = new Map(docs.map((d) => [d._id.toHexString(), d]));
    for (const id of shared) {
      const doc = byHex.get(parseAssignedGoalId(id) ?? "");
      out.set(id, {
        goalId: id,
        title: doc?.title || "Shared goal",
        code: doc?.code || null,
        spec: doc ? assignedSpecFor(doc) : null,
      });
    }
  }
  return goalIds.map((id) => out.get(id)).filter((g): g is CorrelationGoalInput => Boolean(g));
}

/**
 * Everything buildCorrelation needs for one user, every read scoped to
 * (orgId, userId) and riding an existing index:
 *   github_links           github_links_org_user_goal_period
 *   goal_inputs            goal_inputs_org_user_goal_ts
 *   manager verdicts       manager_verdicts_org_subject / manager_verdict_events_subject_goal_period
 *   goal_tier_verdicts     goal_tier_verdicts_org_user_goal_period_uniq
 *   evidence (stars)       evidence_org_user_id_uniq
 *   goal_evidence.files    goal_evidence_org_user_goal
 */
export async function loadCorrelation(
  orgId: ObjectId,
  userId: ObjectId,
  goalId: string | undefined,
  now: Date = new Date(),
): Promise<CorrelationGoal[]> {
  const links = await liveLinks(orgId, userId, goalId);
  const goalIds = [...new Set(links.map((l) => l.goalId))];
  if (goalIds.length === 0) return [];

  const prEvidenceIds = [
    ...new Set(
      links.flatMap((l) => (l.state?.linkedPrs ?? []).map((p) => `mr-gh-${p.prId}`)),
    ),
  ];

  const [goals, inputRows, managerRows, eventRows, aiRows, starredRows, fileGroups] =
    await Promise.all([
      correlationGoals(orgId, userId, goalIds),
      (await getGoalInputsCollection())
        .find(
          { orgId, userId, goalId: { $in: goalIds } },
          {
            projection: {
              goalId: 1,
              ts: 1,
              createdAt: 1,
              source: 1,
              "value.periodKey": 1,
              "value.evidence": 1,
            },
          },
        )
        .sort({ ts: -1 })
        .limit(MAX_CORRELATION_INPUTS)
        .toArray(),
      (await getManagerGoalVerdictsCollection())
        .find(
          { orgId, subjectUserId: userId, goalId: { $in: goalIds } },
          { projection: { goalId: 1, tier: 1, periodKey: 1, gradedAt: 1 } },
        )
        .toArray(),
      (await getManagerGoalVerdictEventsCollection())
        .find(
          { orgId, subjectUserId: userId, goalId: { $in: goalIds }, supersededAt: null },
          { projection: { goalId: 1, tier: 1, periodKey: 1, gradedAt: 1 } },
        )
        .toArray(),
      (await getGoalTierVerdictsCollection())
        .find(
          { orgId, userId, goalId: { $in: goalIds } },
          { projection: { goalId: 1, periodKey: 1, "verdict.tier": 1, gradedAt: 1 } },
        )
        .toArray(),
      prEvidenceIds.length
        ? (await getEvidenceCollection())
            .find({ orgId, userId, id: { $in: prEvidenceIds } }, { projection: { id: 1 } })
            .toArray()
        : Promise.resolve([]),
      (await getDb())
        .collection("goal_evidence.files")
        .aggregate<{ _id: { goalId: string; periodKey: string | null }; n: number }>([
          {
            $match: {
              "metadata.orgId": orgId,
              "metadata.userId": userId,
              "metadata.goalId": { $in: goalIds },
            },
          },
          {
            $group: {
              _id: { goalId: "$metadata.goalId", periodKey: "$metadata.periodKey" },
              n: { $sum: 1 },
            },
          },
        ])
        .toArray(),
    ]);

  // Current projection + active history rows, one per (goal, period): the
  // projection covers legacy grades that predate the history.
  const managerVerdicts = new Map<string, CorrelationVerdict>();
  for (const r of [...managerRows.map((m) => ({ ...m, periodKey: verdictPeriodKey(m) })), ...eventRows]) {
    const k = `${r.goalId}|${r.periodKey}`;
    const prev = managerVerdicts.get(k);
    if (prev && (prev.gradedAt?.getTime() ?? 0) >= (r.gradedAt?.getTime() ?? 0)) continue;
    managerVerdicts.set(k, { goalId: r.goalId, periodKey: r.periodKey, tier: r.tier, gradedAt: r.gradedAt });
  }

  const evidenceFileCounts: Record<string, Record<string, number>> = {};
  for (const g of fileGroups) {
    const per = (evidenceFileCounts[g._id.goalId] ??= {});
    const k = g._id.periodKey ?? "";
    per[k] = (per[k] ?? 0) + g.n;
  }

  return buildCorrelation({
    goals,
    links,
    inputs: inputRows as unknown as CorrelationEntry[],
    managerVerdicts: [...managerVerdicts.values()],
    aiVerdicts: aiRows
      .filter((r) => r.verdict?.tier)
      .map((r) => ({
        goalId: r.goalId,
        periodKey: r.periodKey,
        tier: r.verdict.tier,
        gradedAt: r.gradedAt ?? null,
      })),
    evidenceIds: starredRows.map((r) => r.id),
    evidenceFileCounts,
    now,
  });
}

/** GET /github-links/correlation?goalId= — the caller's own goals. */
export async function correlationHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = requireSession(req);
    const { goalId } = optionalGoalQuerySchema.parse(req.query);
    const goals = await loadCorrelation(session.orgId, session.userId, goalId);
    res.json({ goals });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /manager/reports/:userId/github-correlation?goalId= — the same
 * report for a direct report, behind resolveReport (404 otherwise).
 */
export async function reportCorrelationHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const users = await getUsersCollection();
    const target = await resolveReportFor(req.session, req.params.userId, (q) =>
      users.findOne(q),
    );
    const session = requireSession(req);
    const { goalId } = optionalGoalQuerySchema.parse(req.query);
    const goals = await loadCorrelation(session.orgId, target._id, goalId);
    res.json({ goals });
  } catch (err) {
    next(err);
  }
}

// ─── reserved context answers (integrations/query-routes) ────────────

/**
 * The `issue_state` / `issue_tasklist` templates take the repo and issue
 * number as ordinary params that the AI fills from `{{ctx:__espace_gh_repo}}`
 * and `{{ctx:__espace_gh_issue}}`. Those answers are never stored: they
 * come from the caller's own linked row for the window being filled, and
 * are spread over the stored answers at query time only.
 */
export const GH_REPO_ANSWER = "__espace_gh_repo";
export const GH_ISSUE_ANSWER = "__espace_gh_issue";

export async function reservedGithubAnswers(
  session: Pick<Session, "orgId" | "userId">,
  goalId: string,
  periodPath: ReadonlyArray<number | string> | undefined,
): Promise<Record<string, string>> {
  const first = periodPath?.[0];
  if (typeof first !== "number" || !Number.isInteger(first) || first < 0) return {};
  const col = await getGithubLinksCollection();
  const link = await col.findOne(
    {
      orgId: session.orgId,
      userId: session.userId,
      goalId,
      periodIndex: first,
      status: "linked",
    },
    { projection: { repo: 1, issueNumber: 1 } },
  );
  if (!link || link.issueNumber == null) return {};
  return {
    [GH_REPO_ANSWER]: link.repo,
    [GH_ISSUE_ANSWER]: String(link.issueNumber),
  };
}

/**
 * Comments on a linked issue — the GitHub half of the 1:1 thread.
 *
 *   read  the owner, their manager, or (for a shared `asg_` goal) the
 *         goal's creator sees the mirrored developer replies + what eSpace
 *         has posted (`state.comments`, `posts`).
 *   post  the manager (or asg creator) posts ONE of two things, composed
 *         here on the server from a stored row — never from client text:
 *           manager_note  a `manager_report_notes` row they wrote about this
 *                         report, and only when it is shared with the report
 *           tier_verdict  a `manager_goal_verdict_events` row for this
 *                         link's org / user / goal
 *         The comment carries `buildCommentMarker(kind, sourceId)` as its last
 *         line so a re-sync never mirrors it back as a developer reply, and
 *         `link.posts` makes the post idempotent per (kind, sourceId).
 *
 * The caller's OWN GitHub token is used (they are the one speaking on the
 * issue). Authorization failures are 404s, like every per-report manager
 * read, so the endpoint can't probe which links exist.
 *
 * Injected deps so the whole flow runs against in-memory collections.
 */

import { ObjectId, type Collection } from "mongodb";
import { buildCommentMarker } from "@espace-devhub/shared/github-links";
import type {
  AssignedGoal,
  GithubLink,
  GithubLinkPost,
  GithubLinkPostKind,
  GoalTier,
  ManagerGoalVerdictEvent,
  ManagerReportNote,
  Session,
} from "../../db/types.js";
import type { AuditInput } from "../../lib/audit.js";
import { HttpError } from "../../middleware/error-handler.js";
import { resolveReportFor, type FindOrgUser } from "../manager/resolve-report.js";
import type { GithubClient } from "./github-client.js";
import { linkIdSchema } from "./schemas.js";

export type CommentSession = Pick<Session, "orgId" | "userId" | "role">;

export interface CommentDeps {
  links: Collection<GithubLink>;
  notes: Collection<ManagerReportNote>;
  verdictEvents: Collection<ManagerGoalVerdictEvent>;
  findUser: FindOrgUser;
  findAssignedGoal: (q: {
    _id: ObjectId;
    orgId: ObjectId;
  }) => Promise<Pick<AssignedGoal, "createdBy"> | null>;
  /** The CALLER's GitHub client; 400 integration_not_connected without a token. */
  clientFor: (session: CommentSession) => Promise<GithubClient>;
  now: () => Date;
  audit: (input: AuditInput) => Promise<void>;
}

export type ViewerRole = "owner" | "manager" | "assigner";

const TIER_LABEL: Record<GoalTier, string> = {
  not_achieved: "Not achieved",
  achieved: "Achieved",
  over_achieved: "Over achieved",
  role_model: "Role model",
};

function notFound(): HttpError {
  return new HttpError(404, "not_found", "No such link.");
}

// ─── pure ────────────────────────────────────────────────────────────

/** "Oct 13, 2026" — UTC, so the date doesn't move with the server's zone. */
export function commentDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The marker is ALWAYS the last line — `parseCommentMarker` finds it anywhere. */
function withMarker(text: string, kind: GithubLinkPostKind, sourceId: string): string {
  const marker = buildCommentMarker(kind, sourceId);
  const room = 60_000 - marker.length - 2;
  return `${text.trim().slice(0, room)}\n\n${marker}`;
}

export function renderTierVerdictComment(
  event: Pick<ManagerGoalVerdictEvent, "_id" | "tier" | "note" | "gradedByName" | "gradedAt">,
): string {
  const label = TIER_LABEL[event.tier] ?? event.tier;
  const note = (event.note ?? "").trim();
  const head = note ? `**Tier:** ${label} — ${note}` : `**Tier:** ${label}`;
  const by = event.gradedByName || "their manager";
  return withMarker(
    `${head}\n\n_Graded by ${by} on ${commentDate(event.gradedAt)} in eSpace_`,
    "tier_verdict",
    event._id.toHexString(),
  );
}

export function renderManagerNoteComment(
  note: Pick<ManagerReportNote, "_id" | "body" | "managerName" | "createdAt">,
): string {
  const by = note.managerName || "their manager";
  return withMarker(
    `${note.body.trim()}\n\n_1:1 note from ${by}, ${commentDate(note.createdAt)} in eSpace_`,
    "manager_note",
    note._id.toHexString(),
  );
}

export function findPost(
  link: Pick<GithubLink, "posts">,
  kind: GithubLinkPostKind,
  sourceId: string,
): GithubLinkPost | null {
  return (link.posts ?? []).find((p) => p.kind === kind && p.sourceId === sourceId) ?? null;
}

// ─── authorization ───────────────────────────────────────────────────

/**
 * Load a live link and decide who the caller is to it. Owner only when
 * `allowOwner`; otherwise the owner's active manager (resolveReportFor),
 * or — on a shared goal — the goal's creator. Anyone else: 404.
 */
export async function loadLinkForViewer(
  deps: Pick<CommentDeps, "links" | "findUser" | "findAssignedGoal">,
  session: CommentSession,
  rawLinkId: unknown,
  { allowOwner }: { allowOwner: boolean },
): Promise<{ link: GithubLink; role: ViewerRole }> {
  const parsed = linkIdSchema.safeParse(rawLinkId);
  if (!parsed.success) throw notFound();
  const link = await deps.links.findOne({
    _id: new ObjectId(parsed.data),
    orgId: session.orgId,
  });
  if (!link || link.status === "unlinked") throw notFound();

  if (link.userId.equals(session.userId)) {
    if (allowOwner) return { link, role: "owner" };
    throw notFound();
  }
  if (link.assignedGoalId) {
    const goal = await deps.findAssignedGoal({ _id: link.assignedGoalId, orgId: session.orgId });
    if (goal?.createdBy && goal.createdBy.equals(session.userId)) {
      return { link, role: "assigner" };
    }
  }
  try {
    await resolveReportFor(session, link.userId.toHexString(), deps.findUser);
  } catch {
    throw notFound();
  }
  return { link, role: "manager" };
}

// ─── compose ─────────────────────────────────────────────────────────

async function composeBody(
  deps: Pick<CommentDeps, "notes" | "verdictEvents">,
  session: CommentSession,
  link: GithubLink,
  kind: GithubLinkPostKind,
  sourceId: string,
): Promise<string> {
  const _id = new ObjectId(sourceId);
  if (kind === "manager_note") {
    const note = await deps.notes.findOne({
      _id,
      orgId: session.orgId,
      managerId: session.userId,
      reportId: link.userId,
    });
    if (!note) throw new HttpError(404, "not_found", "No such note.");
    if (note.visibility !== "shared-with-report") {
      throw new HttpError(
        400,
        "note_private",
        "Only notes shared with your report can be posted to GitHub.",
      );
    }
    return renderManagerNoteComment(note);
  }
  const event = await deps.verdictEvents.findOne({
    _id,
    orgId: link.orgId,
    subjectUserId: link.userId,
    goalId: link.goalId,
  });
  if (!event) throw new HttpError(404, "not_found", "No such grade for this goal.");
  return renderTierVerdictComment(event);
}

// ─── post ────────────────────────────────────────────────────────────

/** Double-click / retry guard within this process (the GitHub write isn't transactional). */
const inFlight = new Set<string>();

export interface PostCommentInput {
  linkId: unknown;
  kind: GithubLinkPostKind;
  sourceId: string;
  ip?: string | null;
  ua?: string | null;
}

export async function postLinkComment(
  deps: CommentDeps,
  session: CommentSession,
  input: PostCommentInput,
): Promise<{ post: GithubLinkPost; existing: boolean; link: GithubLink }> {
  const { link } = await loadLinkForViewer(deps, session, input.linkId, { allowOwner: false });
  if (link.status !== "linked" || link.issueNumber == null) {
    throw new HttpError(409, "github_link_not_linked", "This period isn't linked to an issue yet.");
  }

  const existing = findPost(link, input.kind, input.sourceId);
  if (existing) return { post: existing, existing: true, link };

  const lockKey = `${link._id.toHexString()}|${input.kind}|${input.sourceId}`;
  if (inFlight.has(lockKey)) {
    throw new HttpError(409, "github_comment_in_progress", "That post is already on its way.");
  }
  inFlight.add(lockKey);
  try {
    const body = await composeBody(deps, session, link, input.kind, input.sourceId);
    const client = await deps.clientFor(session);
    const created = await client.createComment(link.repo, link.issueNumber, body);
    const post: GithubLinkPost = {
      kind: input.kind,
      sourceId: input.sourceId,
      commentId: created.id,
      postedAt: deps.now(),
      postedBy: session.userId,
    };
    // Re-read so a post recorded meanwhile (another process) isn't dropped.
    const fresh = (await deps.links.findOne({ _id: link._id })) ?? link;
    const posts = [...(fresh.posts ?? []).filter((p) => !(p.kind === post.kind && p.sourceId === post.sourceId)), post];
    await deps.links.updateOne({ _id: link._id }, { $set: { posts } });
    await deps.audit({
      orgId: link.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "github_links.comment.post",
      targetType: "github_link",
      targetId: link._id.toHexString(),
      after: {
        kind: post.kind,
        sourceId: post.sourceId,
        commentId: post.commentId,
        repo: link.repo,
        issueNumber: link.issueNumber,
        subjectUserId: link.userId.toHexString(),
      },
      ip: input.ip ?? null,
      ua: input.ua ?? null,
    });
    return { post, existing: false, link: { ...fresh, posts } };
  } finally {
    inFlight.delete(lockKey);
  }
}

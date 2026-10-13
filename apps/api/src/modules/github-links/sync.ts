/**
 * Read a linked issue back from GitHub and mirror it onto the link row.
 *
 * Ownership rule: GitHub owns `state` (rewritten whole on every sync);
 * eSpace owns everything else. The ONE thing a sync writes beyond the
 * link row is a single `goal_inputs` entry when the issue closes as
 * completed — `source: "github"`, timestamped at the close (so lateness
 * reads the close time), carrying the period's latest values forward so
 * the entry counts for that period exactly like a manual submission.
 *
 * Phase 3 — the same read also mirrors the issue's linked pull requests
 * (`state.linkedPrs`, ≤ 10) and the newest developer replies
 * (`state.comments`, ≤ 20). Both are best-effort: a failed timeline or
 * comments read never fails the state update — the previous arrays stay.
 *
 * Linked PRs come from the timeline (`cross-referenced` / `connected`
 * events whose source is a pull request) plus closing keywords
 * ("fixes #12") in the issue body and comments, same repo only. Each is
 * hydrated through the ISSUES endpoint (`getIssue`), not `/pulls`: the
 * issue id of a PR is the id GitHub's search API returns, which is what
 * the merged-PR evidence id (`mr-gh-<id>`, integrations/github-normalize)
 * is built from — so a PR starred from either place is the same star.
 *
 * Pure parts (`reduceIssue`, `shouldWriteReading`, `reduceTimelinePrRefs`,
 * `reduceComments`, `reducePull`) are exported for tests; `syncLink` takes
 * injected deps so it runs without a database.
 */

import { ObjectId, type Collection } from "mongodb";
import {
  extractClosingRefs,
  parseCommentMarker,
  taskListProgress,
} from "@espace-devhub/shared/github-links";
import {
  getAssignedGoalsCollection,
  getUsersCollection,
} from "../../db/collections.js";
import type {
  GithubLink,
  GithubLinkComment,
  GithubLinkedPr,
  GithubLinkState,
  GoalInputEntry,
  NotificationKind,
} from "../../db/types.js";
import type { AuditInput } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";
import type { CreateNotificationInput } from "../../lib/notifications.js";
import { HttpError } from "../../middleware/error-handler.js";
import type { GithubClient, GithubIssue } from "./github-client.js";
import { normalizeRepo } from "./schemas.js";

// ─── pure ────────────────────────────────────────────────────────────

function toDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** GitHub's issue payload → the slice we persist. Never throws on shape. */
export function reduceIssue(raw: GithubIssue): GithubLinkState {
  const labels: string[] = [];
  for (const l of Array.isArray(raw.labels) ? raw.labels : []) {
    const name = typeof l === "string" ? l : l?.name;
    if (typeof name === "string" && name) labels.push(name.slice(0, 100));
    if (labels.length >= 50) break;
  }
  const assignees: string[] = [];
  for (const a of Array.isArray(raw.assignees) ? raw.assignees : []) {
    if (typeof a?.login === "string" && a.login) assignees.push(a.login.slice(0, 100));
    if (assignees.length >= 20) break;
  }
  const tasks = taskListProgress(raw.body);
  return {
    issueState: raw.state === "closed" ? "closed" : "open",
    stateReason:
      typeof raw.state_reason === "string" ? raw.state_reason.slice(0, 40) : null,
    closedAt: toDate(raw.closed_at),
    updatedAt: toDate(raw.updated_at),
    title: typeof raw.title === "string" ? raw.title.slice(0, 300) : "",
    tasks: { done: tasks.done, total: tasks.total },
    labels,
    assignees,
    commentsCount:
      Number.isInteger(raw.comments) && (raw.comments as number) >= 0
        ? (raw.comments as number)
        : 0,
    linkedPrs: [],
    comments: [],
  };
}

/** The "issue is gone" state, keeping what we last knew for display. */
export function missingState(previous: GithubLinkState | null): GithubLinkState {
  return {
    issueState: "missing",
    stateReason: null,
    closedAt: previous?.closedAt ?? null,
    updatedAt: previous?.updatedAt ?? null,
    title: previous?.title ?? "",
    tasks: previous?.tasks ?? { done: 0, total: 0 },
    labels: previous?.labels ?? [],
    assignees: previous?.assignees ?? [],
    commentsCount: previous?.commentsCount ?? 0,
    linkedPrs: previous?.linkedPrs ?? [],
    comments: previous?.comments ?? [],
  };
}

// ─── linked PRs + comments (Phase 3) ─────────────────────────────────

export const MAX_LINKED_PRS = 10;
export const MAX_COMMENTS = 20;
export const MAX_COMMENT_BODY = 2_000;
export const PR_HYDRATE_SPACING_MS = 300;

export interface PrRef {
  repo: string;
  number: number;
}

const PULL_URL_RE = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/i;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** The PR a timeline event points at, or null when it isn't one. */
function prRefOfEvent(ev: unknown, fallbackRepo: string): PrRef | null {
  if (!isObj(ev)) return null;
  if (ev.event !== "cross-referenced" && ev.event !== "connected") return null;
  const source = isObj(ev.source) ? ev.source : null;
  const issue = source && isObj(source.issue) ? source.issue : isObj(ev.subject) ? ev.subject : null;
  if (!issue || !issue.pull_request) return null;
  const number = issue.number;
  if (!Number.isInteger(number) || (number as number) < 1) return null;
  const repository = isObj(issue.repository) ? issue.repository : null;
  let repo = normalizeRepo(repository?.full_name);
  if (!repo && typeof issue.html_url === "string") {
    const m = PULL_URL_RE.exec(issue.html_url);
    repo = m ? normalizeRepo(m[1]) : null;
  }
  return { repo: repo ?? fallbackRepo, number: number as number };
}

/**
 * Timeline events → the PRs they reference, deduped by `repo#number`, in
 * timeline order. `connected` events carry their PR when GitHub includes
 * it; when it doesn't there is nothing to read and the event is skipped.
 */
export function reduceTimelinePrRefs(
  events: unknown,
  { repo }: { repo: string },
): PrRef[] {
  const own = normalizeRepo(repo) ?? String(repo).toLowerCase();
  const seen = new Set<string>();
  const out: PrRef[] = [];
  for (const ev of Array.isArray(events) ? events : []) {
    const ref = prRefOfEvent(ev, own);
    if (!ref) continue;
    const k = `${ref.repo}#${ref.number}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(ref);
  }
  return out;
}

/**
 * Closing keywords in the issue body + comment bodies, same repo only, and
 * never the issue itself. Whether a ref is actually a PR is learned when
 * it is hydrated (a plain issue is dropped there).
 */
export function closingRefCandidates(
  texts: ReadonlyArray<unknown>,
  { repo, issueNumber }: { repo: string; issueNumber: number | null },
): PrRef[] {
  const own = normalizeRepo(repo) ?? String(repo).toLowerCase();
  const seen = new Set<string>();
  const out: PrRef[] = [];
  for (const t of texts) {
    for (const ref of extractClosingRefs(t, { repo: own })) {
      if (ref.repo !== own || ref.number === issueNumber) continue;
      const k = `${ref.repo}#${ref.number}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ repo: ref.repo, number: ref.number });
    }
  }
  return out;
}

/**
 * A PR read through the issues endpoint → the slice we persist. Null when
 * the payload is not a pull request (a closing ref that named an issue).
 */
export function reducePull(raw: unknown, repo: string): GithubLinkedPr | null {
  if (!isObj(raw) || !raw.pull_request) return null;
  const id = raw.id;
  const number = raw.number;
  if (!Number.isInteger(id) || (id as number) < 1) return null;
  if (!Number.isInteger(number) || (number as number) < 1) return null;
  const pr = isObj(raw.pull_request) ? raw.pull_request : {};
  const mergedAt = toDate(pr.merged_at ?? raw.merged_at);
  const url =
    typeof pr.html_url === "string" && pr.html_url
      ? pr.html_url
      : typeof raw.html_url === "string"
        ? raw.html_url
        : "";
  const user = isObj(raw.user) ? raw.user : null;
  return {
    repo,
    number: number as number,
    prId: id as number,
    url: url.slice(0, 500),
    title: typeof raw.title === "string" ? raw.title.slice(0, 300) : "",
    state: mergedAt ? "merged" : raw.state === "closed" ? "closed" : "open",
    mergedAt,
    author: typeof user?.login === "string" && user.login ? user.login.slice(0, 100) : null,
  };
}

/**
 * Raw issue comments → the newest MAX_COMMENTS developer replies, oldest
 * first. Drops eSpace's own posts (they carry a comment marker) and bot
 * accounts; truncates bodies to MAX_COMMENT_BODY.
 */
export function reduceComments(raw: unknown): GithubLinkComment[] {
  const out: GithubLinkComment[] = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    if (!isObj(c)) continue;
    const user = isObj(c.user) ? c.user : null;
    if (!user || user.type === "Bot") continue;
    const login = typeof user.login === "string" ? user.login : "";
    if (!login) continue;
    const body = typeof c.body === "string" ? c.body : "";
    if (parseCommentMarker(body)) continue;
    const createdAt = toDate(c.created_at);
    if (!Number.isInteger(c.id) || (c.id as number) < 1 || !createdAt) continue;
    out.push({
      commentId: c.id as number,
      author: login.slice(0, 100),
      body: body.slice(0, MAX_COMMENT_BODY),
      createdAt,
      url: typeof c.html_url === "string" ? c.html_url.slice(0, 500) : "",
    });
  }
  out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return out.slice(-MAX_COMMENTS);
}

function isRateLimited(err: unknown): boolean {
  return err instanceof HttpError && err.status === 429;
}

function isNotFound(err: unknown): boolean {
  return err instanceof HttpError && err.status === 404;
}

/**
 * Read the timeline + comments and rebuild `linkedPrs` / `comments`.
 * Every failure is swallowed (logged) and leaves that array as it was.
 */
export async function readLinkExtras(
  deps: Pick<SyncDeps, "client" | "sleep">,
  link: Pick<GithubLink, "_id" | "repo" | "issueNumber">,
  raw: GithubIssue,
  previous: GithubLinkState | null,
): Promise<Pick<GithubLinkState, "linkedPrs" | "comments">> {
  const number = link.issueNumber as number;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const ctx = { linkId: link._id.toHexString(), repo: link.repo };
  let linkedPrs = previous?.linkedPrs ?? [];
  let comments = previous?.comments ?? [];
  let rawComments: unknown[] = [];
  let commentsOk = false;
  let stop = false;

  // Comments first: their bodies feed the closing-ref scan below.
  try {
    const count = Number.isInteger(raw.comments) ? (raw.comments as number) : 0;
    const lastPage = Math.max(1, Math.ceil(count / 100));
    rawComments = await deps.client.listComments(link.repo, number, { page: lastPage });
    // The last page can hold < 20; top up from the page before it.
    if (lastPage > 1 && rawComments.length < MAX_COMMENTS) {
      const before = await deps.client.listComments(link.repo, number, { page: lastPage - 1 });
      rawComments = [...before, ...rawComments];
    }
    comments = reduceComments(rawComments);
    commentsOk = true;
  } catch (err) {
    if (isRateLimited(err)) stop = true;
    logger.warn({ ...ctx, err: err instanceof Error ? err.message : String(err) }, "[github-links] comments read failed");
  }
  if (stop) return { linkedPrs, comments };

  let timeline: unknown[] | null = null;
  try {
    timeline = await deps.client.listTimeline(link.repo, number);
  } catch (err) {
    if (isRateLimited(err)) stop = true;
    logger.warn({ ...ctx, err: err instanceof Error ? err.message : String(err) }, "[github-links] timeline read failed");
  }
  if (stop || timeline === null) return { linkedPrs, comments };

  const fromTimeline = reduceTimelinePrRefs(timeline, { repo: link.repo });
  const bodies: unknown[] = [raw.body];
  if (commentsOk) {
    for (const c of rawComments) {
      if (isObj(c) && isObj(c.user) && c.user.type !== "Bot") bodies.push(c.body);
    }
  }
  const fromText = closingRefCandidates(bodies, { repo: link.repo, issueNumber: number });
  const seen = new Set<string>();
  const candidates: PrRef[] = [];
  for (const ref of [...fromTimeline, ...fromText]) {
    const k = `${ref.repo}#${ref.number}`;
    if (seen.has(k)) continue;
    seen.add(k);
    candidates.push(ref);
  }

  const hydrated: GithubLinkedPr[] = [];
  const ids = new Set<number>();
  let calls = 0;
  try {
    for (const ref of candidates) {
      if (hydrated.length >= MAX_LINKED_PRS) break;
      if (calls > 0) await sleep(PR_HYDRATE_SPACING_MS);
      calls += 1;
      let pr: GithubLinkedPr | null = null;
      try {
        pr = reducePull(await deps.client.getIssue(ref.repo, ref.number), ref.repo);
      } catch (err) {
        // A deleted / private / cross-repo PR we can't see: skip it.
        if (isNotFound(err)) continue;
        if (err instanceof HttpError && err.status === 400) continue;
        throw err;
      }
      if (!pr || ids.has(pr.prId)) continue;
      ids.add(pr.prId);
      hydrated.push(pr);
    }
    linkedPrs = hydrated;
  } catch (err) {
    logger.warn({ ...ctx, err: err instanceof Error ? err.message : String(err) }, "[github-links] PR hydration failed");
  }
  return { linkedPrs, comments };
}

/**
 * True exactly once per link: the issue is closed as completed (never
 * "not planned") and no reading has been written for it yet.
 */
export function shouldWriteReading(
  link: Pick<GithubLink, "readingInputId">,
  state: Pick<GithubLinkState, "issueState" | "stateReason">,
): boolean {
  return (
    state.issueState === "closed" &&
    state.stateReason !== "not_planned" &&
    link.readingInputId == null
  );
}

// ─── deps ────────────────────────────────────────────────────────────

export interface ReadingRecipient {
  userId: ObjectId;
  kind: NotificationKind;
}

export interface SyncDeps {
  links: Collection<GithubLink>;
  inputs: Collection<GoalInputEntry>;
  client: GithubClient;
  now: () => Date;
  audit: (input: AuditInput) => Promise<void>;
  notify: (input: CreateNotificationInput) => Promise<unknown>;
  /** Best-effort "Reconnect" flag on the integration row. */
  markError?: (message: string) => Promise<void>;
  /** Who hears about a closed period. Injected: the real one reads users / assigned_goals. */
  recipients?: (link: GithubLink) => Promise<ReadingRecipient[]>;
  /** The display name of the link's owner, for the notification copy. */
  ownerName?: (link: GithubLink) => Promise<string | null>;
  /** Spacing between PR hydration reads. Defaults to a real 300 ms timer. */
  sleep?: (ms: number) => Promise<void>;
}

export interface SyncResult {
  link: GithubLink;
  readingWritten: boolean;
  /** Set when the sync failed for this link (the batch carries on). */
  error?: { code: string; message: string };
}

/**
 * Production recipient resolution: a shared goal's creator, or an own
 * goal's active manager. Empty when there is nobody to tell.
 */
export async function resolveReadingRecipients(link: GithubLink): Promise<ReadingRecipient[]> {
  if (link.assignedGoalId) {
    const doc = await (await getAssignedGoalsCollection()).findOne(
      { _id: link.assignedGoalId, orgId: link.orgId },
      { projection: { createdBy: 1 } },
    );
    return doc?.createdBy ? [{ userId: doc.createdBy, kind: "github_issue_closed" }] : [];
  }
  const users = await getUsersCollection();
  const owner = await users.findOne(
    { _id: link.userId, orgId: link.orgId },
    { projection: { managerId: 1 } },
  );
  if (!owner?.managerId) return [];
  const manager = await users.findOne(
    { _id: owner.managerId, orgId: link.orgId },
    { projection: { status: 1 } },
  );
  return manager && manager.status === "active"
    ? [{ userId: manager._id, kind: "github_issue_closed" }]
    : [];
}

export async function resolveOwnerName(link: GithubLink): Promise<string | null> {
  const owner = await (await getUsersCollection()).findOne(
    { _id: link.userId, orgId: link.orgId },
    { projection: { displayName: 1, email: 1 } },
  );
  return owner?.displayName || owner?.email || null;
}

// ─── the reading ─────────────────────────────────────────────────────

/**
 * The newest entry for this link's period — what the new row carries
 * forward so the close doesn't blank a half-filled form.
 */
async function latestPeriodEntry(
  inputs: Collection<GoalInputEntry>,
  link: GithubLink,
): Promise<GoalInputEntry | null> {
  const base = { orgId: link.orgId, userId: link.userId, goalId: link.goalId };
  const filter =
    link.periodKey != null
      ? { ...base, "value.periodKey": link.periodKey }
      : { ...base, "value.periodKey": null };
  const rows = await inputs
    .find(filter as never)
    .sort({ createdAt: -1, ts: -1 })
    .limit(1)
    .toArray();
  return rows[0] ?? null;
}

async function writeReading(
  deps: SyncDeps,
  link: GithubLink,
  state: GithubLinkState,
): Promise<ObjectId | null> {
  const closedAt = state.closedAt ?? deps.now();
  const previous = await latestPeriodEntry(deps.inputs, link);
  const prevValue =
    previous && previous.value && typeof previous.value === "object" && !Array.isArray(previous.value)
      ? (previous.value as Record<string, unknown>)
      : {};
  const value: Record<string, unknown> = {
    ...prevValue,
    ...(link.periodKey != null ? { periodKey: link.periodKey } : {}),
    github: {
      issueNumber: link.issueNumber,
      repo: link.repo,
      closedAt: closedAt.toISOString(),
      url: link.issueUrl,
    },
  };
  if (link.periodKey == null) delete value.periodKey;

  const doc = {
    _id: new ObjectId(),
    orgId: link.orgId,
    userId: link.userId,
    goalId: link.goalId,
    ts: closedAt,
    value,
    note: `Closed on GitHub: ${link.issueUrl ?? `#${link.issueNumber}`}`.slice(0, 2000),
    source: "github" as const,
    createdAt: closedAt,
  } satisfies GoalInputEntry;
  const result = await deps.inputs.insertOne(doc);
  return result.insertedId ?? doc._id;
}

// ─── one link ────────────────────────────────────────────────────────

function isRateLimit(err: unknown): err is HttpError {
  return err instanceof HttpError && err.status === 429;
}

export async function syncLink(deps: SyncDeps, link: GithubLink): Promise<SyncResult> {
  if (link.status !== "linked" || link.issueNumber == null) {
    return {
      link,
      readingWritten: false,
      error: { code: "github_link_not_linked", message: "This period isn't linked to an issue." },
    };
  }
  const now = deps.now();

  let raw: GithubIssue;
  try {
    raw = await deps.client.getIssue(link.repo, link.issueNumber);
  } catch (err) {
    if (isRateLimit(err)) {
      await deps.links.updateOne(
        { _id: link._id },
        { $set: { lastSyncError: "rate_limited" } },
      );
      throw err;
    }
    if (err instanceof HttpError && err.status === 404) {
      const state = missingState(link.state);
      await deps.links.updateOne(
        { _id: link._id },
        { $set: { state, lastSyncedAt: now, lastSyncError: null, syncFailures: 0 } },
      );
      return { link: { ...link, state, lastSyncedAt: now, lastSyncError: null, syncFailures: 0 }, readingWritten: false };
    }
    const code = err instanceof HttpError ? err.code : "github_upstream_error";
    const message =
      err instanceof HttpError ? err.message : "Couldn't read this issue from GitHub.";
    await deps.links.updateOne(
      { _id: link._id },
      { $set: { lastSyncError: code.slice(0, 200) }, $inc: { syncFailures: 1 } },
    );
    if (code === "integration_needs_reconnect" && deps.markError) {
      await deps.markError("github-links sync: token rejected");
    }
    return {
      link: { ...link, lastSyncError: code, syncFailures: link.syncFailures + 1 },
      readingWritten: false,
      error: { code, message },
    };
  }

  const base = reduceIssue(raw);
  const extras = await readLinkExtras(deps, link, raw, link.state);
  const state: GithubLinkState = { ...base, ...extras };
  await deps.links.updateOne(
    { _id: link._id },
    { $set: { state, lastSyncedAt: now, lastSyncError: null, syncFailures: 0 } },
  );
  let next: GithubLink = { ...link, state, lastSyncedAt: now, lastSyncError: null, syncFailures: 0 };

  if (!shouldWriteReading(link, state)) {
    return { link: next, readingWritten: false };
  }

  const readingInputId = await writeReading(deps, next, state);
  const readingClosedAt = state.closedAt ?? now;
  await deps.links.updateOne(
    { _id: link._id },
    { $set: { readingInputId, readingClosedAt } },
  );
  next = { ...next, readingInputId, readingClosedAt };

  await deps.audit({
    orgId: link.orgId,
    actorUserId: null,
    actorRole: null,
    action: "github_links.reading",
    targetType: "github_link",
    targetId: link._id.toHexString(),
    after: {
      goalId: link.goalId,
      periodIndex: link.periodIndex,
      issueNumber: link.issueNumber,
      readingInputId: readingInputId?.toHexString() ?? null,
      closedAt: readingClosedAt.toISOString(),
    },
  });

  const recipients = deps.recipients ? await deps.recipients(next) : [];
  if (recipients.length > 0) {
    const who = (deps.ownerName ? await deps.ownerName(next) : null) || "A teammate";
    for (const r of recipients) {
      await deps.notify({
        orgId: link.orgId,
        userId: r.userId,
        kind: r.kind,
        title: `${who} closed "${next.periodLabel}" on GitHub`.slice(0, 200),
        body: `GitHub issue #${link.issueNumber} in ${link.repo} was closed as completed — the period is logged as done.`.slice(
          0,
          2_000,
        ),
        data: {
          goalId: link.goalId,
          ...(link.assignedGoalId ? { assignedGoalId: link.assignedGoalId.toHexString() } : {}),
          subjectUserId: link.userId.toHexString(),
          periodIndex: link.periodIndex,
          periodLabel: next.periodLabel,
          repo: link.repo,
          issueNumber: link.issueNumber,
          issueUrl: link.issueUrl,
        },
        createdBy: link.userId,
      });
    }
  }

  return { link: next, readingWritten: true };
}

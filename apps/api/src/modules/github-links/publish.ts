/**
 * Publish a COMPOSED tracker's periods to GitHub as issues — one issue per
 * period, with a claim-first idempotency design so a retry, a double-click
 * or a crash between "issue created" and "row finalised" can never create
 * a second issue:
 *
 *   1. claim   upsert a `pending` github_links row per period on the
 *              unique idempotencyKey (sha256 of org|user|goal|periodIndex)
 *   2. adopt   list the repo's `espace` issues once, parse the marker in
 *              each body, and finalise any claimed row whose issue already
 *              exists (crash recovery)
 *   3. create  the rest, sequentially, ≥ 1 s apart
 *
 * Every dependency with a side effect (collection, GitHub client, clock,
 * sleep, audit, notify) is injected so the whole flow runs in a unit test
 * against an in-memory collection and a recording client.
 */

import { createHash } from "node:crypto";
import { ObjectId, type Collection } from "mongodb";
import {
  assignedWindows,
  isAssignedGoalId,
  resolvePeriodContent,
  type AssignedWindow,
} from "@espace-devhub/shared/goal-specs";
import {
  buildIssueBody,
  buildIssueTitle,
  ESPACE_LABEL,
  ESPACE_LABEL_COLOR,
  espaceLabel,
  parseMarker,
} from "@espace-devhub/shared/github-links";
import { getGoalsCollection, getGoalSpecsCollection } from "../../db/collections.js";
import type { GithubLink, UserRole } from "../../db/types.js";
import { assignedSpecRecordFor, requireActiveAssignee } from "../../lib/assigned-goals.js";
import type { AuditInput } from "../../lib/audit.js";
import type { CreateNotificationInput } from "../../lib/notifications.js";
import { HttpError } from "../../middleware/error-handler.js";
import { hasOpenApproval } from "../goal-specs/approval.js";
import type { GithubClient } from "./github-client.js";

export const PENDING_CLAIM_TTL_MS = 10 * 60 * 1000;
export const CREATE_SPACING_MS = 1_000;

// ─── target resolution (DB) ──────────────────────────────────────────

/** Everything publish needs to know about the goal, resolved once. */
export interface PublishTarget {
  spec: Record<string, unknown>;
  goalTitle: string;
  goalCode: string | null;
  assignedGoalId: ObjectId | null;
  specRevision: number | null;
  /** The shared goal's creator (notified on publish); null for own goals. */
  creatorId: ObjectId | null;
  /** The creator's suggested repo on a shared goal. */
  defaultRepo: string | null;
}

/**
 * Own goal → the user's goal_specs row + the L2 in their goals tree.
 * Shared goal → the assigned goal's spec (must be an active assignee).
 */
export async function resolvePublishTarget(
  orgId: ObjectId,
  userId: ObjectId,
  goalId: string,
): Promise<PublishTarget> {
  if (isAssignedGoalId(goalId)) {
    const doc = await requireActiveAssignee(orgId, userId, goalId);
    const record = await assignedSpecRecordFor(orgId, userId, goalId);
    if (!record?.spec) {
      throw new HttpError(404, "spec_not_found", "This tracker no longer exists.");
    }
    return {
      spec: record.spec,
      goalTitle: doc.title,
      goalCode: doc.code || null,
      assignedGoalId: doc._id,
      specRevision: doc.specRevision ?? null,
      creatorId: doc.createdBy,
      defaultRepo: doc.github?.repo ?? null,
    };
  }
  const specs = await getGoalSpecsCollection();
  const row = await specs.findOne({ orgId, userId, goalId });
  if (!row?.spec) {
    throw new HttpError(404, "spec_not_found", "This tracker no longer exists.");
  }
  const tree = await (await getGoalsCollection()).findOne({ orgId, userId });
  let goalTitle = "";
  let goalCode: string | null = null;
  for (const l1 of tree?.l1s ?? []) {
    for (const l2 of l1.l2s ?? []) {
      if (l2.id === goalId) {
        goalTitle = l2.title || "";
        goalCode = l2.code || null;
      }
    }
  }
  if (!goalTitle) {
    const specTitle = (row.spec as { title?: unknown }).title;
    goalTitle = typeof specTitle === "string" ? specTitle : "Goal";
  }
  return {
    spec: row.spec,
    goalTitle,
    goalCode,
    assignedGoalId: null,
    specRevision: null,
    creatorId: null,
    defaultRepo: null,
  };
}

// ─── gates ───────────────────────────────────────────────────────────

/** 400 unless the spec is a live COMPOSED plan with authored periods. */
export function assertPublishable(spec: Record<string, unknown>): void {
  if (spec.widget !== "COMPOSED") {
    throw new HttpError(
      400,
      "github_not_publishable",
      "Only composed trackers can be published to GitHub.",
    );
  }
  if (hasOpenApproval(spec)) {
    throw new HttpError(
      400,
      "github_not_publishable",
      "Get this tracker approved first.",
    );
  }
  const periods = (spec.composed as { periods?: unknown } | null | undefined)?.periods;
  if (!Array.isArray(periods) || periods.length === 0) {
    throw new HttpError(
      400,
      "github_not_publishable",
      "This tracker has no periods to publish.",
    );
  }
}

// ─── helpers ─────────────────────────────────────────────────────────

export function idempotencyKey(
  orgId: ObjectId,
  userId: ObjectId,
  goalId: string,
  periodIndex: number,
): string {
  return createHash("sha256")
    .update(`v1|${orgId.toHexString()}|${userId.toHexString()}|${goalId}|${periodIndex}`)
    .digest("hex");
}

/**
 * Absolute link to the goals page for the issue body, when the app has a
 * public https origin. Same env contract as the email links
 * (APP_URL, NEXT_PUBLIC_APP_URL); a localhost origin is omitted — a
 * GitHub issue linking to localhost helps no one.
 */
export function hubGoalsUrl(): string | null {
  const raw =
    process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
  if (!/^https:\/\//.test(raw)) return null;
  return `${raw.replace(/\/$/, "")}/dev/goals`;
}

function windowsToPublish(
  spec: Record<string, unknown>,
  periodIndexes: number[] | undefined,
  nowMs: number,
): AssignedWindow[] {
  const windows = assignedWindows(spec, nowMs);
  const periods = (spec.composed as { periods?: unknown[] }).periods ?? [];
  // Only windows an authored period covers — a flat tail past the plan's
  // stated length has nothing to put in an issue.
  const covered = windows.filter((w) => w.index < periods.length);
  if (!periodIndexes) return covered;
  const wanted = new Set(periodIndexes);
  return covered.filter((w) => wanted.has(w.index));
}

// ─── the flow ────────────────────────────────────────────────────────

export interface PublishDeps {
  links: Collection<GithubLink>;
  client: GithubClient;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  audit: (input: AuditInput) => Promise<void>;
  notify: (input: CreateNotificationInput) => Promise<unknown>;
  /** Best-effort "Reconnect" flag on the integration row. */
  markError?: (message: string) => Promise<void>;
  hubUrl?: string | null;
}

export interface PublishInput {
  orgId: ObjectId;
  userId: ObjectId;
  actorRole: UserRole | null;
  actorName?: string | null;
  goalId: string;
  repo: string;
  periodIndexes?: number[];
  target: PublishTarget;
  ip?: string | null;
  ua?: string | null;
}

export interface PublishOutcome {
  /** Every live row for the goal after the run (pending / linked / failed). */
  links: GithubLink[];
  created: number;
  adopted: number;
  skipped: number;
  /** Periods left unpublished because GitHub rate-limited us mid-batch. */
  remaining: number;
  retryAfterMs?: number;
}

interface Claimed {
  id: ObjectId;
  window: AssignedWindow;
  periodKey: string | null;
  periodLabel: string;
}

function isRateLimit(err: unknown): err is HttpError {
  return err instanceof HttpError && err.status === 429;
}
function isAuthFailure(err: unknown): err is HttpError {
  return err instanceof HttpError && err.code === "integration_needs_reconnect";
}
function errorCode(err: unknown): string {
  return err instanceof HttpError ? err.code : "github_upstream_error";
}

export async function publishGoalToGithub(
  deps: PublishDeps,
  input: PublishInput,
): Promise<PublishOutcome> {
  const { target } = input;
  assertPublishable(target.spec);
  const now = deps.now();
  const nowMs = now.getTime();
  const windows = windowsToPublish(target.spec, input.periodIndexes, nowMs);
  if (windows.length === 0) {
    throw new HttpError(
      400,
      "github_not_publishable",
      "None of the requested periods exist on this tracker.",
    );
  }

  const baseAudit = {
    orgId: input.orgId,
    actorUserId: input.userId,
    actorRole: input.actorRole,
    targetType: "github_link",
    ip: input.ip ?? null,
    ua: input.ua ?? null,
  };

  // 1. claim
  const claimed: Claimed[] = [];
  let skipped = 0;
  const cutoff = new Date(nowMs - PENDING_CLAIM_TTL_MS);
  for (const w of windows) {
    const content = resolvePeriodContent(target.spec, w.index);
    const periodLabel = (content.label || w.label || `Period ${w.index + 1}`).slice(0, 200);
    const key = idempotencyKey(input.orgId, input.userId, input.goalId, w.index);
    const freshId = new ObjectId();
    const pendingRow: GithubLink = {
      _id: freshId,
      orgId: input.orgId,
      userId: input.userId,
      goalId: input.goalId,
      assignedGoalId: target.assignedGoalId,
      periodIndex: w.index,
      periodKey: w.key,
      periodLabel,
      repo: input.repo,
      idempotencyKey: key,
      status: "pending",
      claimedAt: now,
      issueNumber: null,
      issueId: null,
      issueNodeId: null,
      issueUrl: null,
      labelsApplied: false,
      createdBy: input.userId,
      createdAt: now,
      lastSyncedAt: null,
      lastSyncError: null,
      syncFailures: 0,
      state: null,
      readingInputId: null,
      readingClosedAt: null,
      posts: [],
      specRevision: target.specRevision,
      stale: false,
      unlinkedAt: null,
    };
    const existing = await deps.links.findOneAndUpdate(
      { idempotencyKey: key },
      { $setOnInsert: pendingRow },
      { upsert: true, returnDocument: "before" },
    );
    if (!existing) {
      claimed.push({ id: freshId, window: w, periodKey: w.key, periodLabel });
      continue;
    }
    if (existing.status === "linked") {
      skipped += 1;
      continue;
    }
    if (existing.status === "pending" && existing.claimedAt.getTime() >= cutoff.getTime()) {
      throw new HttpError(
        409,
        "github_publish_in_progress",
        "This tracker is being published right now. Give it a minute and refresh.",
      );
    }
    // A failed row has nothing in flight; a pending one older than the TTL
    // belongs to a process that died. Either way, re-claim — guarded so two
    // racing retries can't both win.
    const reclaim = await deps.links.updateOne(
      {
        _id: existing._id,
        $or: [
          { status: "failed" },
          { status: "pending", claimedAt: { $lt: cutoff } },
        ],
      },
      {
        $set: {
          status: "pending",
          claimedAt: now,
          repo: input.repo,
          periodKey: w.key,
          periodLabel,
          lastSyncError: null,
          specRevision: target.specRevision,
          assignedGoalId: target.assignedGoalId,
        },
      },
    );
    if (reclaim.matchedCount !== 1) {
      throw new HttpError(
        409,
        "github_publish_in_progress",
        "This tracker is being published right now. Give it a minute and refresh.",
      );
    }
    claimed.push({ id: existing._id, window: w, periodKey: w.key, periodLabel });
  }

  const goalLabel = espaceLabel(target.goalCode, input.goalId);
  let created = 0;
  let adopted = 0;
  let remaining = 0;
  let retryAfterMs: number | undefined;

  const markFailed = async (id: ObjectId, code: string): Promise<void> => {
    await deps.links.updateOne(
      { _id: id, status: "pending" },
      { $set: { status: "failed", lastSyncError: code.slice(0, 200) } },
    );
  };
  const markAllFailed = async (rows: Claimed[], code: string): Promise<void> => {
    for (const c of rows) await markFailed(c.id, code);
  };

  const finalise = async (
    c: Claimed,
    issue: { number: number; id: number; node_id: string; html_url: string },
    labelsApplied: boolean,
    stale: boolean,
  ): Promise<void> => {
    await deps.links.updateOne(
      { _id: c.id },
      {
        $set: {
          status: "linked",
          issueNumber: issue.number,
          issueId: issue.id,
          issueNodeId: issue.node_id,
          issueUrl: issue.html_url,
          labelsApplied,
          lastSyncError: null,
          stale,
        },
      },
    );
  };

  if (claimed.length > 0) {
    // 2. adopt — crash recovery by marker. One list call per publish.
    try {
      const issues = await deps.client.listIssuesByLabels(
        input.repo,
        [ESPACE_LABEL, goalLabel],
        { state: "all" },
      );
      for (const issue of issues) {
        const marker = parseMarker(issue.body);
        if (
          !marker ||
          marker.orgId !== input.orgId.toHexString() ||
          marker.userId !== input.userId.toHexString() ||
          marker.goalId !== input.goalId
        ) {
          continue;
        }
        const idx = claimed.findIndex((c) => c.window.index === marker.periodIndex);
        if (idx < 0) continue;
        const [c] = claimed.splice(idx, 1) as [Claimed];
        await finalise(c, issue, true, marker.periodKey !== c.periodKey);
        adopted += 1;
        await deps.audit({
          ...baseAudit,
          action: "github_links.adopt",
          targetId: c.id.toHexString(),
          after: { goalId: input.goalId, periodIndex: c.window.index, issueNumber: issue.number },
        });
      }
    } catch (err) {
      if (isRateLimit(err)) {
        await markAllFailed(claimed, "rate_limited");
        remaining = claimed.length;
        retryAfterMs = err.retryAfterMs;
        claimed.length = 0;
      } else {
        await markAllFailed(claimed, errorCode(err));
        if (isAuthFailure(err) && deps.markError) {
          await deps.markError("github-links publish: reconciliation rejected");
        }
        throw err;
      }
    }
  }

  // 3. create the rest, sequentially.
  let labelsOk: boolean | null = null;
  for (let i = 0; i < claimed.length; i += 1) {
    const c = claimed[i] as Claimed;
    if (i > 0) await deps.sleep(CREATE_SPACING_MS);
    try {
      if (labelsOk === null) {
        labelsOk =
          (await deps.client.ensureLabel(input.repo, {
            name: ESPACE_LABEL,
            color: ESPACE_LABEL_COLOR,
            description: "Created by eSpace Dev Hub",
          })) &&
          (await deps.client.ensureLabel(input.repo, {
            name: goalLabel,
            color: ESPACE_LABEL_COLOR,
            description: target.goalTitle.slice(0, 100),
          }));
      }
      const content = resolvePeriodContent(target.spec, c.window.index);
      const marker = {
        orgId: input.orgId.toHexString(),
        userId: input.userId.toHexString(),
        goalId: input.goalId,
        periodIndex: c.window.index,
        periodKey: c.periodKey,
      };
      const title = buildIssueTitle({
        goalCode: target.goalCode,
        goalTitle: target.goalTitle,
        periodLabel: c.periodLabel,
      });
      const body = buildIssueBody({
        period: {
          label: c.periodLabel,
          dueAt: content.dueAt,
          prompt: content.prompt,
          detail: content.detail as never,
        },
        goalTitle: target.goalTitle,
        hubUrl: deps.hubUrl ?? null,
        marker,
      });
      const { issue, labelsApplied } = await deps.client.createIssue(input.repo, {
        title,
        body,
        labels: labelsOk ? [ESPACE_LABEL, goalLabel] : [],
      });
      await finalise(c, issue, labelsOk && labelsApplied, false);
      created += 1;
      await deps.audit({
        ...baseAudit,
        action: "github_links.publish",
        targetId: c.id.toHexString(),
        after: {
          goalId: input.goalId,
          periodIndex: c.window.index,
          issueNumber: issue.number,
          labelsApplied: labelsOk && labelsApplied,
        },
      });
    } catch (err) {
      if (isRateLimit(err)) {
        const rest = claimed.slice(i);
        await markAllFailed(rest, "rate_limited");
        remaining = rest.length;
        retryAfterMs = err.retryAfterMs;
        break;
      }
      await markFailed(c.id, errorCode(err));
      if (isAuthFailure(err)) {
        await markAllFailed(claimed.slice(i + 1), "integration_needs_reconnect");
        if (deps.markError) {
          await deps.markError("github-links publish: token rejected");
        }
        throw err;
      }
      // Any other per-issue failure: keep going; the row says why.
    }
  }

  if (target.assignedGoalId && target.creatorId && created + adopted > 0) {
    const who = input.actorName?.trim() || "An assignee";
    const n = created + adopted;
    await deps.notify({
      orgId: input.orgId,
      userId: target.creatorId,
      kind: "github_issues_published",
      title: `${who} published "${target.goalTitle}" to GitHub`.slice(0, 200),
      body: `${who} published ${n} period${n === 1 ? "" : "s"} of "${target.goalTitle}" as GitHub issues in ${input.repo}.`.slice(
        0,
        2_000,
      ),
      data: {
        assignedGoalId: target.assignedGoalId.toHexString(),
        goalId: input.goalId,
        repo: input.repo,
        count: n,
        subjectUserId: input.userId.toHexString(),
      },
      createdBy: input.userId,
    });
  }

  const links = await deps.links
    .find({
      orgId: input.orgId,
      userId: input.userId,
      goalId: input.goalId,
      status: { $in: ["pending", "linked", "failed"] },
    })
    .sort({ periodIndex: 1 })
    .toArray();

  return {
    links,
    created,
    adopted,
    skipped,
    remaining,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
}

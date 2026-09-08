/**
 * Goal evidence files — the deliverable itself, not a link to it.
 *
 * A period's fields can already hold a `link`, which works when the artifact
 * lives somewhere the reviewer can reach. Plenty of real deliverables don't:
 * retrospective notes someone wrote in a text file, an exported PDF, a
 * self-contained HTML report. This lets the user attach the actual bytes to
 * the period they belong to, in whatever format the plan asked for.
 *
 * STORAGE — GridFS (`goal_evidence` bucket) in the same Mongo the rest of the
 * app uses. That buys org/user scoping, backups and credentials we already
 * have, at the cost of not being a CDN; with a 10 MB ceiling and evidence
 * being read rarely (a review, a manager spot-check), that trade is right for
 * this scale. Files are never written to disk anywhere in the process.
 *
 * SERVING — every download is `Content-Disposition: attachment` with
 * `X-Content-Type-Options: nosniff`, and the stored content type is never
 * echoed back for the risky formats. This is not incidental: users explicitly
 * want to attach .html, and serving an attacker-authored HTML file inline from
 * the API origin would be stored XSS against every session on it. Evidence is
 * downloaded, never rendered by us.
 *
 * ACCESS — the owner reads and writes their own evidence; a manager may READ a
 * direct report's (same `managerId` rule every other manager query uses, see
 * modules/manager/controller.ts). Nobody else, and nobody at all may write to
 * someone else's goal.
 */

import type { NextFunction, Request, Response } from "express";
import { GridFSBucket, ObjectId, type Db } from "mongodb";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { getUsersCollection } from "../../db/collections.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { HttpError } from "../../middleware/error-handler.js";

/** Mirrors the extract path's ceiling — see ai/extract/limits.ts. */
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

/**
 * Per goal, not per period: a plan with 13 weekly windows and three artifacts
 * each still fits, while a runaway client can't turn a goal into unbounded
 * storage. Enforced on upload, counted from what's already stored.
 */
const MAX_FILES_PER_GOAL = 60;

const BUCKET_NAME = "goal_evidence";

/**
 * What a user may attach. Deliberately a list of what the plans in play
 * actually produce (documents, sheets, notes, screenshots) rather than "any
 * binary" — an allowlist is the one control that keeps this from becoming a
 * general file host. Extension is checked alongside the browser-supplied MIME
 * type, because the latter is a hint, not a fact.
 */
const ALLOWED = new Map<string, string>([
  ["pdf", "application/pdf"],
  ["doc", "application/msword"],
  [
    "docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  ["xls", "application/vnd.ms-excel"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["ppt", "application/vnd.ms-powerpoint"],
  [
    "pptx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  ["csv", "text/csv"],
  ["txt", "text/plain"],
  ["md", "text/markdown"],
  ["html", "text/html"],
  ["htm", "text/html"],
  ["json", "application/json"],
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["svg", "image/svg+xml"],
  ["zip", "application/zip"],
]);

/**
 * Types we will never hand back with their own content type, whatever they
 * were uploaded as. `text/html` and `image/svg+xml` both execute script in a
 * browsing context; `application/octet-stream` + attachment disposition makes
 * the download inert. The FILE is preserved byte for byte — only the response
 * header is neutralised.
 */
const NEVER_INLINE = new Set([
  "text/html",
  "image/svg+xml",
  "application/xhtml+xml",
]);

const QUOTE = String.fromCharCode(34);
const SEMICOLON = String.fromCharCode(59);
const BACKSLASH = String.fromCharCode(92);
/** Path separators, either slash. */
const SEPARATORS = new RegExp('[' + BACKSLASH + BACKSLASH + '/]');
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Strip anything that could steer a filesystem or a header. The name is only
 * ever metadata and a download filename, but it is user-controlled text that
 * ends up in a `Content-Disposition`, so it gets flattened here rather than at
 * the point of use.
 */
function safeName(raw: string): string {
  const base = raw.split(SEPARATORS).pop() || "evidence";
  // Written as a code-point filter rather than a regex class because the
  // characters being removed are exactly the ones that are painful to
  // express (and to read) as escapes: C0 controls, DEL, and the quote /
  // semicolon / backslash trio that can break out of a Content-Disposition
  // value or steer a path.
  let cleaned = "";
  for (const ch of base) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    if (ch === QUOTE || ch === SEMICOLON || ch === BACKSLASH) continue;
    cleaned += ch;
  }
  return (cleaned.trim() || "evidence").slice(0, 180);
}

interface EvidenceFileMeta {
  orgId: ObjectId;
  userId: ObjectId;
  goalId: string;
  /** Which cycle window this belongs to; null for a goal-level attachment. */
  periodKey: string | null;
  contentType: string;
  originalName: string;
}

interface PublicEvidenceFile {
  id: string;
  name: string;
  contentType: string;
  size: number;
  periodKey: string | null;
  uploadedAt: string;
}

function bucket(db: Db): GridFSBucket {
  return new GridFSBucket(db, { bucketName: BUCKET_NAME });
}

const goalIdSchema = z.string().min(1).max(200);
const periodKeySchema = z.string().min(1).max(200);

function goalIdParam(req: Request): string {
  const parsed = goalIdSchema.safeParse(req.params.goalId);
  if (!parsed.success) {
    throw new HttpError(400, "validation_error", "Invalid goal id.");
  }
  return parsed.data;
}

function fileIdParam(req: Request): ObjectId {
  const raw = req.params.fileId;
  if (typeof raw !== "string" || !ObjectId.isValid(raw)) {
    throw new HttpError(400, "validation_error", "Invalid file id.");
  }
  return new ObjectId(raw);
}

function requireSession(req: Request) {
  const session = req.session;
  if (!session) {
    throw new HttpError(401, "unauthenticated", "Login required.");
  }
  return session;
}

/**
 * `Content-Disposition` for a download. Two filenames on purpose: the RFC 5987
 * `filename*` carries the real UTF-8 name, and the plain `filename` is an
 * ASCII-only fallback for clients that ignore it. Built with a code-point
 * filter for the same reason safeName is.
 */
function buildDisposition(name: string): string {
  let ascii = "";
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    ascii += code >= 0x20 && code <= 0x7e ? ch : "_";
  }
  const q = String.fromCharCode(34);
  return (
    "attachment; filename=" +
    q +
    ascii +
    q +
    "; filename*=UTF-8''" +
    encodeURIComponent(name)
  );
}

// ─── POST /api/v1/goal-evidence/:goalId ──────────────────────────────

/**
 * Attach one file to a goal (optionally to one period of it).
 *
 * Multer has already enforced the byte cap and single-file rule in the route
 * layer, in memory. Everything here is about whether this user may store this
 * kind of file against this goal.
 */
export async function uploadEvidenceFileHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = requireSession(req);
    const goalId = goalIdParam(req);
    const file = req.file;
    if (!file || !file.buffer) {
      throw new HttpError(
        400,
        "invalid_upload",
        "Attach exactly one file in the `file` field.",
      );
    }

    const periodKeyRaw = req.body?.periodKey;
    let periodKey: string | null = null;
    if (typeof periodKeyRaw === "string" && periodKeyRaw.trim()) {
      const parsed = periodKeySchema.safeParse(periodKeyRaw.trim());
      if (!parsed.success) {
        throw new HttpError(400, "validation_error", "Invalid period key.");
      }
      periodKey = parsed.data;
    }

    const originalName = safeName(file.originalname || "evidence");
    const ext = extensionOf(originalName);
    const allowedType = ALLOWED.get(ext);
    if (!allowedType) {
      throw new HttpError(
        400,
        "unsupported_file_type",
        `Can't attach a .${ext || "?"} file. Allowed: ${[...new Set(ALLOWED.keys())].join(", ")}.`,
      );
    }
    // The extension decides the stored type, not the browser's claim — a
    // .txt announced as text/html stays text/plain.
    const contentType = allowedType;

    const db = await getDb();
    const files = db.collection(`${BUCKET_NAME}.files`);
    const existing = await files.countDocuments({
      "metadata.orgId": session.orgId,
      "metadata.userId": session.userId,
      "metadata.goalId": goalId,
    });
    if (existing >= MAX_FILES_PER_GOAL) {
      throw new HttpError(
        409,
        "too_many_files",
        `This goal already has ${MAX_FILES_PER_GOAL} attachments. Delete one first.`,
      );
    }

    const metadata: EvidenceFileMeta = {
      orgId: session.orgId,
      userId: session.userId,
      goalId,
      periodKey,
      contentType,
      originalName,
    };

    const fileId = await new Promise<ObjectId>((resolve, reject) => {
      const stream = bucket(db).openUploadStream(originalName, {
        contentType,
        metadata,
      });
      stream.on("error", reject);
      stream.on("finish", () => resolve(stream.id as ObjectId));
      stream.end(file.buffer);
    });

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "goal_evidence.upload",
      targetType: "goal",
      targetId: goalId,
      after: {
        fileId: fileId.toHexString(),
        periodKey,
        size: file.size,
        contentType,
      },
      ...networkMeta(req),
    });

    res.status(201).json({
      file: {
        id: fileId.toHexString(),
        name: originalName,
        contentType,
        size: file.size,
        periodKey,
        uploadedAt: new Date().toISOString(),
      } satisfies PublicEvidenceFile,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/v1/goal-evidence/:goalId ───────────────────────────────

/**
 * List what's attached to a goal. `?userId=` lets a manager read a direct
 * report's evidence — the same `managerId === session.userId` check every
 * other cross-user read in this API makes, and the only way to see someone
 * else's files.
 */
export async function listEvidenceFilesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = requireSession(req);
    const goalId = goalIdParam(req);
    const ownerId = await resolveOwner(req, session);

    const db = await getDb();
    const rows = await db
      .collection(`${BUCKET_NAME}.files`)
      .find({
        "metadata.orgId": session.orgId,
        "metadata.userId": ownerId,
        "metadata.goalId": goalId,
      })
      .sort({ uploadDate: -1 })
      .limit(MAX_FILES_PER_GOAL)
      .toArray();

    res.json({
      files: rows.map((r) => ({
        id: (r._id as ObjectId).toHexString(),
        name: (r.metadata?.originalName as string) || (r.filename as string),
        contentType: (r.metadata?.contentType as string) || "application/octet-stream",
        size: r.length as number,
        periodKey: (r.metadata?.periodKey as string | null) ?? null,
        uploadedAt: (r.uploadDate as Date).toISOString(),
      })) satisfies PublicEvidenceFile[],
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Whose evidence is being asked for. Absent `userId`, the caller's own. With
 * one, the caller must be that user's manager — checked against the users
 * collection on every request rather than trusted from a role claim, because
 * the report→manager link is the only thing that authorises this read.
 */
async function resolveOwner(
  req: Request,
  session: NonNullable<Request["session"]>,
): Promise<ObjectId> {
  const raw = req.query.userId;
  if (typeof raw !== "string" || !raw) return session.userId;
  if (!ObjectId.isValid(raw)) {
    throw new HttpError(400, "validation_error", "Invalid user id.");
  }
  const target = new ObjectId(raw);
  if (target.equals(session.userId)) return session.userId;

  const users = await getUsersCollection();
  const report = await users.findOne({ _id: target, orgId: session.orgId });
  if (!report?.managerId || !report.managerId.equals(session.userId)) {
    // Deliberately the same 404 a nonexistent user gets: a manager probing
    // ids shouldn't learn who exists from the difference.
    throw new HttpError(404, "not_found", "No evidence for that user.");
  }
  return target;
}

// ─── GET /api/v1/goal-evidence/file/:fileId ──────────────────────────

/**
 * Download one file. Always as an attachment, always with the sniffing
 * opt-out — see the header comment on why HTML evidence makes that
 * non-negotiable.
 */
export async function downloadEvidenceFileHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = requireSession(req);
    const fileId = fileIdParam(req);
    const db = await getDb();
    const row = await db.collection(`${BUCKET_NAME}.files`).findOne({ _id: fileId });
    if (!row || !row.metadata) {
      throw new HttpError(404, "not_found", "That file doesn't exist.");
    }
    const meta = row.metadata as EvidenceFileMeta;
    if (!meta.orgId?.equals?.(session.orgId)) {
      throw new HttpError(404, "not_found", "That file doesn't exist.");
    }
    if (!meta.userId.equals(session.userId)) {
      const users = await getUsersCollection();
      const owner = await users.findOne({ _id: meta.userId, orgId: session.orgId });
      if (!owner?.managerId || !owner.managerId.equals(session.userId)) {
        throw new HttpError(404, "not_found", "That file doesn't exist.");
      }
    }

    const stored = meta.contentType || "application/octet-stream";
    const served = NEVER_INLINE.has(stored) ? "application/octet-stream" : stored;
    const name = safeName(meta.originalName || (row.filename as string));

    res.setHeader("Content-Type", served);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Length", String(row.length));
    // `filename*` carries the real (UTF-8) name; the plain `filename` is the
    // ASCII-safe fallback for older clients.
    res.setHeader(
      "Content-Disposition",
      buildDisposition(name),
    );
    // Evidence is private to one user (or their manager) — never let a shared
    // cache hold a copy.
    res.setHeader("Cache-Control", "private, no-store");

    const stream = bucket(db).openDownloadStream(fileId);
    stream.on("error", () => {
      // Headers are already out by the time a chunk fails; the only honest
      // move left is to end the response rather than append an error body to
      // a partial file.
      if (!res.headersSent) {
        next(new HttpError(500, "download_failed", "Couldn't read that file."));
        return;
      }
      res.destroy();
    });
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/v1/goal-evidence/file/:fileId ───────────────────────

/** Only the owner deletes. A manager reading a report's evidence can't remove it. */
export async function deleteEvidenceFileHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = requireSession(req);
    const fileId = fileIdParam(req);
    const db = await getDb();
    const row = await db.collection(`${BUCKET_NAME}.files`).findOne({ _id: fileId });
    const meta = row?.metadata as EvidenceFileMeta | undefined;
    if (
      !meta ||
      !meta.orgId?.equals?.(session.orgId) ||
      !meta.userId.equals(session.userId)
    ) {
      throw new HttpError(404, "not_found", "That file doesn't exist.");
    }
    await bucket(db).delete(fileId);
    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "goal_evidence.delete",
      targetType: "goal",
      targetId: meta.goalId,
      before: { fileId: fileId.toHexString(), name: meta.originalName },
      ...networkMeta(req),
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

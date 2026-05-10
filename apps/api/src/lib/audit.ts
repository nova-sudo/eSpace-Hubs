/**
 * Audit-log writer. The single entry point for emitting an audit row —
 * call sites pass a structured intent and this module handles redaction,
 * timestamping, and durable insert.
 *
 * Append-only by convention: there is no `updateAudit` or `deleteAudit`.
 * If you find yourself needing one, you're not auditing — you're using
 * audit_log as a working table, which is wrong.
 *
 * Best-effort: a failed insert MUST NOT break the originating request.
 * The route handler succeeded; that's what the user's contract was. We
 * log the audit failure for operators to investigate.
 */

import type { ObjectId } from "mongodb";
import type { Request } from "express";
import { getAuditLogCollection } from "../db/collections.js";
import type { AuditLogEntry, UserRole } from "../db/types.js";
import { logger } from "./logger.js";

export interface AuditInput {
  orgId: ObjectId;
  /** `null` for system actions (cron, auto-snapshot, …). */
  actorUserId: ObjectId | null;
  actorRole: UserRole | null;
  /** Dot-namespaced verb. Validator pattern: ^[a-z][a-z0-9_]*(\..+)+$ */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  /** Pre/post-mutation state. Caller is responsible for redaction. */
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  ua?: string | null;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  const entry: Omit<AuditLogEntry, "_id"> = {
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    before: input.before,
    after: input.after,
    ip: input.ip ?? null,
    ua: input.ua ?? null,
    ts: new Date(),
  };

  try {
    const col = await getAuditLogCollection();
    await col.insertOne(entry as AuditLogEntry);
  } catch (err) {
    // Audit failure is non-fatal — log and continue.
    logger.error(
      {
        action: input.action,
        actorUserId: input.actorUserId?.toHexString() ?? null,
        err: err instanceof Error ? err.message : String(err),
      },
      "[audit] write failed",
    );
  }
}

/**
 * Pull the network metadata Express normalises onto the request. Used
 * by every audit call site.
 */
export function networkMeta(req: Request): { ip: string | null; ua: string | null } {
  return {
    ip: req.ip ?? null,
    ua: req.get("user-agent") ?? null,
  };
}

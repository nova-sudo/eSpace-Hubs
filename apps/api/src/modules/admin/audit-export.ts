/**
 * GET /api/v1/admin/audit/export.csv — the audit feed as CSV (hub-audit
 * §2.4: "Compliance asks for a CSV").
 *
 * Same filters as GET /admin/audit (action, actorUserId, targetType,
 * targetId, since, until) minus paging: every matching row, newest
 * first, streamed from a Mongo cursor so a large export never sits in
 * memory. Capped at EXPORT_CAP rows; when the cap truncates, a final
 * comment line says so (the admin narrows the date range and exports
 * again). The export itself is audited — reading the whole log out of
 * the app is a privileged act.
 *
 * Columns: ts, action, actor_user_id, actor_name, actor_role,
 *          target_type, target_id, before, after, ip, user_agent
 * `before` / `after` are compact JSON. Cells that a spreadsheet would
 * evaluate as a formula (= + - @, tab, CR) are prefixed with a quote
 * (OWASP CSV-injection guidance).
 */

import type { NextFunction, Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getAuditLogCollection, getUsersCollection } from "../../db/collections.js";
import type { AuditLogEntry } from "../../db/types.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";
import { HttpError } from "../../middleware/error-handler.js";
import { exportAuditQuerySchema } from "./schemas.js";

export const EXPORT_CAP = 50_000;

export const CSV_HEADER = [
  "ts",
  "action",
  "actor_user_id",
  "actor_name",
  "actor_role",
  "target_type",
  "target_id",
  "before",
  "after",
  "ip",
  "user_agent",
] as const;

/** One CSV cell: formula-neutralised, quoted when needed. Pure. */
export function csvCell(value: unknown): string {
  let s: string;
  if (value === null || value === undefined) s = "";
  else if (typeof value === "string") s = value;
  else {
    try {
      s = JSON.stringify(value) ?? "";
    } catch {
      s = String(value);
    }
  }
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** One audit row as a CSV line (no trailing newline). Pure. */
export function auditCsvLine(row: AuditLogEntry, actorName: string | null): string {
  return [
    row.ts.toISOString(),
    row.action,
    row.actorUserId ? row.actorUserId.toHexString() : "",
    actorName ?? "",
    row.actorRole ?? "",
    row.targetType ?? "",
    row.targetId ?? "",
    row.before === undefined ? "" : row.before,
    row.after === undefined ? "" : row.after,
    row.ip ?? "",
    row.ua ?? "",
  ]
    .map(csvCell)
    .join(",");
}

export async function exportAuditCsvHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const q = exportAuditQuerySchema.parse(req.query);
    const filter: Record<string, unknown> = { orgId: session.orgId };
    if (q.action) filter.action = q.action;
    if (q.actorUserId) filter.actorUserId = new ObjectId(q.actorUserId);
    if (q.targetType) filter.targetType = q.targetType;
    if (q.targetId) filter.targetId = q.targetId;
    if (q.since || q.until) {
      const tsRange: Record<string, Date> = {};
      if (q.since) tsRange.$gte = new Date(q.since);
      if (q.until) tsRange.$lt = new Date(q.until);
      filter.ts = tsRange;
    }

    // Actor names for the whole org, once — audit rows carry ids only.
    const users = await getUsersCollection();
    const people = await users
      .find({ orgId: session.orgId }, { projection: { displayName: 1, email: 1 } })
      .toArray();
    const names = new Map(people.map((p) => [p._id.toHexString(), p.displayName || p.email]));

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "audit.export",
      targetType: "org",
      targetId: session.orgId.toHexString(),
      after: { filters: { ...q } },
      ...networkMeta(req),
    });

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="audit-log-${stamp}.csv"`,
    );
    res.setHeader("Cache-Control", "no-store");
    // BOM so Excel reads UTF-8 names correctly.
    res.write(`﻿${CSV_HEADER.join(",")}\r\n`);

    const col = await getAuditLogCollection();
    const cursor = col
      .find(filter)
      .sort({ ts: -1, _id: -1 })
      .limit(EXPORT_CAP + 1);
    // The admin can cancel the download at any time. Once the socket is
    // gone `drain` never fires, so every wait below races it against
    // `close`, and the cursor is released as soon as the client leaves.
    let gone = false;
    const onClose = () => {
      gone = true;
      void cursor.close().catch(() => undefined);
    };
    res.once("close", onClose);
    const waitDrain = () =>
      new Promise<void>((resolve) => {
        const done = () => {
          res.off("drain", done);
          res.off("close", done);
          res.off("error", done);
          resolve();
        };
        res.once("drain", done);
        res.once("close", done);
        res.once("error", done);
      });
    try {
      let n = 0;
      let truncated = false;
      for await (const row of cursor) {
        if (gone) break;
        if (n === EXPORT_CAP) {
          truncated = true;
          break;
        }
        const actor = row.actorUserId ? names.get(row.actorUserId.toHexString()) ?? null : null;
        const ok = res.write(`${auditCsvLine(row, actor)}\r\n`);
        n += 1;
        if (!ok) await waitDrain();
      }
      if (gone) return;
      if (truncated) {
        res.write(
          `# truncated at ${EXPORT_CAP} rows — narrow the date range and export again\r\n`,
        );
      }
      res.end();
    } catch (streamErr) {
      if (gone) return;
      // A mid-stream DB failure must not look like a complete file: say so
      // in a trailer row the admin will see, then end the response.
      logger.warn(
        { err: streamErr instanceof Error ? streamErr.message : String(streamErr) },
        "[audit-export] stream failed mid-export",
      );
      res.end("# export failed part-way — this file is INCOMPLETE; export again\r\n");
    } finally {
      res.off("close", onClose);
      await cursor.close().catch(() => undefined);
    }
  } catch (err) {
    // Headers already sent → the stream is mid-flight; mark it incomplete.
    if (res.headersSent) {
      if (!res.writableEnded) {
        res.end("# export failed part-way — this file is INCOMPLETE; export again\r\n");
      }
      return;
    }
    next(err);
  }
}

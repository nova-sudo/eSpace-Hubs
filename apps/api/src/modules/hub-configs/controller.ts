/**
 * Hub-config controller — admin-only CRUD over per-(orgId, hubId)
 * overrides on top of the shared registry defaults.
 *
 *   GET    /api/v1/hub-configs           list every override for the org
 *   GET    /api/v1/hub-configs/:hubId    one override (or 404 if absent)
 *   PUT    /api/v1/hub-configs/:hubId    upsert; body shape in schemas.ts
 *   DELETE /api/v1/hub-configs/:hubId    revert to registry default
 *
 * Validation of the hubId path param: must be a known hub in the
 * shared registry. We refuse to write an override for a hub the app
 * doesn't ship with — that row would just be dead weight.
 *
 * Audit: every mutation writes a `hub_config.upsert` /
 * `hub_config.delete` row.
 */

import type { NextFunction, Request, Response } from "express";
import { findHubById, HUB_ORDER } from "@espace-devhub/shared/hubs";
import { getHubConfigsCollection } from "../../db/collections.js";
import type { HubConfig } from "../../db/types.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { HttpError } from "../../middleware/error-handler.js";
import { upsertHubConfigSchema } from "./schemas.js";

function requireHubId(req: Request): string {
  const { hubId } = req.params as { hubId?: string };
  if (typeof hubId !== "string" || hubId.length === 0) {
    throw new HttpError(400, "validation_error", "Missing hubId.");
  }
  if (!findHubById(hubId)) {
    throw new HttpError(
      404,
      "unknown_hub",
      `Hub "${hubId}" is not registered. Known hubs: ${HUB_ORDER.join(", ")}.`,
    );
  }
  return hubId;
}

function toPublic(row: HubConfig): Record<string, unknown> {
  const { _id, orgId, updatedBy, ...rest } = row;
  return {
    id: _id.toHexString(),
    orgId: orgId.toHexString(),
    updatedBy: updatedBy ? updatedBy.toHexString() : null,
    ...rest,
  };
}

// ─── GET /api/v1/hub-configs ─────────────────────────────────────────

export async function listHubConfigsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) throw new HttpError(401, "unauthenticated", "Login required.");
    const col = await getHubConfigsCollection();
    const rows = await col.find({ orgId: session.orgId }).toArray();
    res.json({ configs: rows.map(toPublic) });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/v1/hub-configs/:hubId ──────────────────────────────────

export async function getHubConfigHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) throw new HttpError(401, "unauthenticated", "Login required.");
    const hubId = requireHubId(req);
    const col = await getHubConfigsCollection();
    const row = await col.findOne({ orgId: session.orgId, hubId });
    if (!row) {
      throw new HttpError(
        404,
        "not_found",
        `No override for hub "${hubId}" — using registry defaults.`,
      );
    }
    res.json({ config: toPublic(row) });
  } catch (err) {
    next(err);
  }
}

// ─── PUT /api/v1/hub-configs/:hubId ──────────────────────────────────

export async function upsertHubConfigHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) throw new HttpError(401, "unauthenticated", "Login required.");
    const hubId = requireHubId(req);
    const payload = upsertHubConfigSchema.parse(req.body);

    const now = new Date();
    const col = await getHubConfigsCollection();

    // Build the $set patch from only the fields the client supplied.
    // Undefined fields are LEFT ALONE on an existing row — partial
    // PATCH semantics on PUT. Clients that want to clear a field
    // explicitly send `null`.
    const set: Record<string, unknown> = {
      updatedAt: now,
      updatedBy: session.userId,
    };
    if (payload.enabled !== undefined) set.enabled = payload.enabled;
    if (payload.label !== undefined) set.label = payload.label;
    if (payload.description !== undefined) set.description = payload.description;
    if (payload.allowedIntegrations !== undefined)
      set.allowedIntegrations = payload.allowedIntegrations;
    if (payload.pages !== undefined) set.pages = payload.pages;
    if (payload.departments !== undefined) set.departments = payload.departments;

    const result = await col.findOneAndUpdate(
      { orgId: session.orgId, hubId },
      {
        $set: set,
        $setOnInsert: {
          orgId: session.orgId,
          hubId,
        },
      },
      { upsert: true, returnDocument: "after" },
    );

    const row = result;
    if (!row) {
      throw new HttpError(500, "internal_error", "Upsert returned no document.");
    }

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "hub_config.upsert",
      targetType: "hub",
      targetId: hubId,
      after: payload,
      ...networkMeta(req),
    });

    res.json({ config: toPublic(row) });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/v1/hub-configs/:hubId ───────────────────────────────

export async function deleteHubConfigHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) throw new HttpError(401, "unauthenticated", "Login required.");
    const hubId = requireHubId(req);
    const col = await getHubConfigsCollection();
    const result = await col.deleteOne({ orgId: session.orgId, hubId });

    if (result.deletedCount === 0) {
      // Idempotent — deleting a missing override is a no-op, not an
      // error. The post-delete state is identical either way.
      res.json({ ok: true, deleted: false });
      return;
    }

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "hub_config.delete",
      targetType: "hub",
      targetId: hubId,
      ...networkMeta(req),
    });

    res.json({ ok: true, deleted: true });
  } catch (err) {
    next(err);
  }
}

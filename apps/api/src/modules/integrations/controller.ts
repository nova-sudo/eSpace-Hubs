/**
 * Integrations controller — connect / list / disconnect.
 *
 * Encryption boundary:
 *   - The HTTP layer accepts plaintext tokens (over TLS, with auth)
 *   - The controller encrypts via crypto-secret.ts BEFORE persisting
 *   - Mongo only ever sees envelope strings (`v1.<iv>.<tag>.<ct>`)
 *   - The PUBLIC shape returned to clients carries booleans, never
 *     ciphertext, never plaintext
 *
 * Replace semantics on POST: every connect overwrites the entire row
 * for (orgId, userId, providerId). The frontend's connection flow
 * always submits the full token set for a provider; partial-merge
 * semantics would invite "I removed my apiToken but it's still there"
 * surprises.
 *
 * Internal token-access helper (`loadDecryptedTokens`) is exported
 * for the future proxy module — it's the server-side path that turns
 * a stored row into outbound HTTP headers. NEVER call this from a
 * route that returns JSON to the client; the whole point of the
 * encryption layer is that decrypted tokens stay in the API process.
 */

import type { NextFunction, Request, Response } from "express";
import type { ObjectId } from "mongodb";
import { z } from "zod";
import { getIntegrationsCollection } from "../../db/collections.js";
import type { Integration } from "../../db/types.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import {
  decryptSecret,
  encryptSecret,
} from "../../lib/crypto-secret.js";
import { logger } from "../../lib/logger.js";
import { HttpError } from "../../middleware/error-handler.js";

// ─── input schema ────────────────────────────────────────────────────

// Trim whitespace BEFORE the min-length check so a token that's
// "just whitespace" rejects, and a token with trailing newline /
// space (the standard copy-paste mistake) is normalised to the
// clean string. Without this, the bytes flow through encryption,
// decryption, and into the upstream Authorization header — where
// undici rejects newlines as invalid header values and the proxy
// surfaces a useless "fetch failed".
const tokenString = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1).max(2_048));

const upsertSchema = z.object({
  providerId: z.string().min(1).max(64),
  label: z.string().max(200).default(""),
  // At least one of these must be set — enforced after parse.
  accessToken: tokenString.optional(),
  apiToken: tokenString.optional(),
  refreshToken: tokenString.optional(),
  // `email` is overloaded — Jira stores the user's Atlassian email
  // (used for Basic auth), Jenkins stores the username (also used
  // for Basic auth). Both are free-form identifiers from the user's
  // perspective; we let either shape through and rely on the
  // provider-specific token form to validate format. Length cap is
  // unchanged.
  email: z.string().min(1).max(320).nullable().optional(),
  endpointUrl: z.string().url().max(1_000).nullable().optional(),
  scopes: z.array(z.string().max(200)).max(50).default([]),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  // Cleartext identity metadata — non-secret. Connect flows send these
  // alongside the token in a follow-up save (after the provider's
  // /user lookup). Optional so the first token-only save still passes.
  username: z.string().max(200).nullable().optional(),
  displayName: z.string().max(200).nullable().optional(),
  avatarUrl: z.string().max(2_000).nullable().optional(),
  team: z.string().max(200).nullable().optional(),
});

// Token-free profile update (PATCH). Identity metadata only — never
// touches token bytes, so it can't be used to swap a credential. Used
// by the github username self-heal path and any future "rename my
// connection" UI. `.strict()` rejects stray token fields outright.
const profileSchema = z
  .object({
    label: z.string().max(200).optional(),
    username: z.string().max(200).nullable().optional(),
    displayName: z.string().max(200).nullable().optional(),
    avatarUrl: z.string().max(2_000).nullable().optional(),
    team: z.string().max(200).nullable().optional(),
  })
  .strict();

const providerIdParam = (req: Request): string => {
  const { providerId } = req.params;
  if (typeof providerId !== "string" || providerId.length === 0) {
    throw new HttpError(400, "validation_error", "Invalid providerId.");
  }
  if (providerId.length > 64) {
    throw new HttpError(400, "validation_error", "providerId too long.");
  }
  return providerId;
};

// ─── public shape (NEVER includes ciphertext) ────────────────────────

interface PublicIntegration {
  providerId: string;
  label: string;
  email: string | null;
  endpointUrl: string | null;
  scopes: string[];
  connectedAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  /** Connected = at least one token present. */
  connected: boolean;
  hasAccessToken: boolean;
  hasApiToken: boolean;
  hasRefreshToken: boolean;
  // Cleartext identity — safe to echo back (non-secret).
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  team: string | null;
}

function toPublic(i: Integration): PublicIntegration {
  return {
    providerId: i.providerId,
    label: i.label,
    email: i.email,
    endpointUrl: i.endpointUrl,
    scopes: i.scopes,
    connectedAt: i.connectedAt.toISOString(),
    expiresAt: i.expiresAt ? i.expiresAt.toISOString() : null,
    lastUsedAt: i.lastUsedAt ? i.lastUsedAt.toISOString() : null,
    lastErrorAt: i.lastErrorAt ? i.lastErrorAt.toISOString() : null,
    lastError: i.lastError,
    connected: !!(i.encryptedToken || i.encryptedApiToken),
    hasAccessToken: !!i.encryptedToken,
    hasApiToken: !!i.encryptedApiToken,
    hasRefreshToken: !!i.refreshToken,
    username: i.username ?? null,
    displayName: i.displayName ?? null,
    avatarUrl: i.avatarUrl ?? null,
    team: i.team ?? null,
  };
}

// ─── server-side internal helpers ────────────────────────────────────

/**
 * Best-effort update of `lastUsedAt` after a successful outbound
 * call. Fire-and-forget — failure here mustn't break the proxy
 * response the user already received.
 */
export async function markIntegrationUsed(input: {
  orgId: ObjectId;
  userId: ObjectId;
  providerId: string;
}): Promise<void> {
  try {
    const col = await getIntegrationsCollection();
    await col.updateOne(
      {
        orgId: input.orgId,
        userId: input.userId,
        providerId: input.providerId,
      },
      { $set: { lastUsedAt: new Date(), lastErrorAt: null, lastError: null } },
    );
  } catch (err) {
    logger.warn(
      {
        userId: input.userId.toHexString(),
        providerId: input.providerId,
        err: err instanceof Error ? err.message : String(err),
      },
      "[integrations] markIntegrationUsed failed",
    );
  }
}

/**
 * Record a proxy failure on the integration row so the UI can show
 * a "Reconnect" banner. Caps the message to 2 KB. Best-effort.
 */
export async function markIntegrationError(input: {
  orgId: ObjectId;
  userId: ObjectId;
  providerId: string;
  message: string;
}): Promise<void> {
  try {
    const col = await getIntegrationsCollection();
    await col.updateOne(
      {
        orgId: input.orgId,
        userId: input.userId,
        providerId: input.providerId,
      },
      {
        $set: {
          lastErrorAt: new Date(),
          lastError: input.message.slice(0, 2_000),
        },
      },
    );
  } catch (err) {
    logger.warn(
      {
        userId: input.userId.toHexString(),
        providerId: input.providerId,
        err: err instanceof Error ? err.message : String(err),
      },
      "[integrations] markIntegrationError failed",
    );
  }
}

/**
 * Load and decrypt tokens for outbound use.
 *
 * NEVER call from a public-facing route that returns JSON to the
 * client. The whole point of the encryption layer is that decrypted
 * tokens stay inside the API process — only outbound HTTP headers
 * see them.
 *
 * Returns null if the integration doesn't exist OR if any required
 * envelope fails to decrypt (which would mean key rotation is mid-
 * flight or the row is corrupt). Caller surfaces a re-connect prompt.
 */
export async function loadDecryptedTokens(input: {
  orgId: ObjectId;
  userId: ObjectId;
  providerId: string;
}): Promise<{
  accessToken: string | null;
  apiToken: string | null;
  refreshToken: string | null;
  email: string | null;
  endpointUrl: string | null;
} | null> {
  const col = await getIntegrationsCollection();
  const row = await col.findOne({
    orgId: input.orgId,
    userId: input.userId,
    providerId: input.providerId,
  });
  if (!row) return null;
  try {
    return {
      accessToken: row.encryptedToken
        ? decryptSecret(row.encryptedToken)
        : null,
      apiToken: row.encryptedApiToken
        ? decryptSecret(row.encryptedApiToken)
        : null,
      refreshToken: row.refreshToken
        ? decryptSecret(row.refreshToken)
        : null,
      email: row.email,
      endpointUrl: row.endpointUrl,
    };
  } catch (err) {
    logger.error(
      {
        userId: input.userId.toHexString(),
        providerId: input.providerId,
        err: err instanceof Error ? err.message : String(err),
      },
      "[integrations] decrypt failed — row may be from a rotated key",
    );
    return null;
  }
}

// ─── POST /api/v1/integrations ───────────────────────────────────────

export async function upsertIntegrationHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const payload = upsertSchema.parse(req.body);

    if (!payload.accessToken && !payload.apiToken) {
      throw new HttpError(
        400,
        "validation_error",
        "At least one of accessToken or apiToken must be provided.",
      );
    }

    const encryptedToken = payload.accessToken
      ? encryptSecret(payload.accessToken)
      : null;
    const encryptedApiToken = payload.apiToken
      ? encryptSecret(payload.apiToken)
      : null;
    const refreshToken = payload.refreshToken
      ? encryptSecret(payload.refreshToken)
      : null;

    const now = new Date();
    const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;

    // Credential fields use REPLACE semantics (a connect submits the
    // full token set). Identity fields MERGE — they arrive in a
    // separate follow-up save after the provider's /user lookup, so a
    // token-only save must not null them out. Only set identity keys
    // the caller actually provided.
    const set: Partial<Integration> = {
      label: payload.label || payload.providerId,
      encryptedToken,
      encryptedApiToken,
      refreshToken,
      email: payload.email ?? null,
      endpointUrl: payload.endpointUrl ?? null,
      scopes: payload.scopes,
      connectedAt: now,
      expiresAt,
      // Reset error state on a fresh connect.
      lastErrorAt: null,
      lastError: null,
    };
    if (payload.username !== undefined) set.username = payload.username;
    if (payload.displayName !== undefined) set.displayName = payload.displayName;
    if (payload.avatarUrl !== undefined) set.avatarUrl = payload.avatarUrl;
    if (payload.team !== undefined) set.team = payload.team;

    const col = await getIntegrationsCollection();
    const result = await col.findOneAndUpdate(
      {
        orgId: session.orgId,
        userId: session.userId,
        providerId: payload.providerId,
      },
      {
        $set: set,
        $setOnInsert: {
          orgId: session.orgId,
          userId: session.userId,
          providerId: payload.providerId,
          lastUsedAt: null,
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (!result) {
      throw new HttpError(500, "internal_error", "Integration upsert failed.");
    }

    // The audit row's `after` carries metadata only — never the
    // tokens, never the ciphertext. The whole audit log is dumped
    // through the same redaction layer the logger uses, but it's
    // still better not to put secrets in there in the first place.
    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "integrations.connect",
      targetType: "integration",
      targetId: payload.providerId,
      after: {
        providerId: payload.providerId,
        label: result.label,
        hasAccessToken: !!encryptedToken,
        hasApiToken: !!encryptedApiToken,
        hasRefreshToken: !!refreshToken,
        scopes: payload.scopes,
      },
      ...networkMeta(req),
    });

    res.json(toPublic(result));
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/v1/integrations ────────────────────────────────────────

export async function listIntegrationsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const col = await getIntegrationsCollection();
    const rows = await col
      .find({ orgId: session.orgId, userId: session.userId })
      .toArray();
    res.json({ integrations: rows.map(toPublic) });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/v1/integrations/:providerId ────────────────────────────

export async function getIntegrationHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const providerId = providerIdParam(req);
    const col = await getIntegrationsCollection();
    const row = await col.findOne({
      orgId: session.orgId,
      userId: session.userId,
      providerId,
    });
    if (!row) {
      throw new HttpError(404, "not_found", `Not connected to ${providerId}.`);
    }
    res.json(toPublic(row));
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/v1/integrations/:providerId ─────────────────────────

export async function disconnectIntegrationHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const providerId = providerIdParam(req);
    const col = await getIntegrationsCollection();
    const result = await col.deleteOne({
      orgId: session.orgId,
      userId: session.userId,
      providerId,
    });

    if (result.deletedCount > 0) {
      await writeAudit({
        orgId: session.orgId,
        actorUserId: session.userId,
        actorRole: session.role,
        action: "integrations.disconnect",
        targetType: "integration",
        targetId: providerId,
        ...networkMeta(req),
      });
    }
    res.json({ ok: true, deleted: result.deletedCount });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /api/v1/integrations/:providerId ──────────────────────────

/**
 * Update non-secret identity metadata on an EXISTING connection
 * (username / displayName / avatarUrl / team / label). Never creates a
 * row and never touches token bytes — `profileSchema.strict()` rejects
 * any credential field, so this can't be abused to swap a token via a
 * token-free request.
 *
 * Primary caller: the frontend's github username self-heal, which
 * back-fills `username` for rows connected before identity was
 * persisted server-side. 404 when the provider isn't connected.
 *
 * No audit entry — this is cosmetic profile metadata, not a
 * security-relevant state change like connect/disconnect.
 */
export async function patchIntegrationProfileHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const providerId = providerIdParam(req);
    const patch = profileSchema.parse(req.body);

    const set: Partial<Integration> = {};
    if (patch.label !== undefined) set.label = patch.label || providerId;
    if (patch.username !== undefined) set.username = patch.username;
    if (patch.displayName !== undefined) set.displayName = patch.displayName;
    if (patch.avatarUrl !== undefined) set.avatarUrl = patch.avatarUrl;
    if (patch.team !== undefined) set.team = patch.team;

    if (Object.keys(set).length === 0) {
      throw new HttpError(
        400,
        "validation_error",
        "No profile fields to update.",
      );
    }

    const col = await getIntegrationsCollection();
    const result = await col.findOneAndUpdate(
      { orgId: session.orgId, userId: session.userId, providerId },
      { $set: set },
      { returnDocument: "after" }, // no upsert — profile attaches to a live connection only
    );
    if (!result) {
      throw new HttpError(404, "not_found", `Not connected to ${providerId}.`);
    }
    res.json(toPublic(result));
  } catch (err) {
    next(err);
  }
}

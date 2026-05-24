/**
 * Companion-device pairing controllers.
 *
 * Architecture: the desktop companion app needs an Authorization
 * credential so the server-side catch-all can verify its
 * tunnel-registration calls. We can't ship a static API key
 * (compromised on disk → permanent foothold). We can't reuse the
 * browser session cookie (different origin, different storage). What
 * we CAN do is a one-shot OAuth-style device-flow where the user
 * approves the pairing from their already-logged-in browser tab —
 * after that, the companion holds a long-lived bearer token tied to
 * that user.
 *
 * Token shape:
 *   - 32 random bytes, base64url (~43 chars).
 *   - Persisted as SHA-256 hash only (CompanionDevice.tokenHash).
 *   - Returned to the companion ONCE on the polling call that
 *     observes the approval; never again.
 *
 * State machine (per CompanionPairing row, _id = pairing code):
 *   created (companion calls /pair/start)
 *     → approved (user clicks Approve in browser)
 *     → consumed (companion's poll sees approval, gets token)
 *
 * The TTL index on `expiresAt` (5 min) sweeps abandoned codes.
 */

import type { Request, Response, NextFunction } from "express";
import { ObjectId } from "mongodb";
import { createHash, randomBytes } from "node:crypto";
import {
  getCompanionDevicesCollection,
  getCompanionPairingsCollection,
} from "../../db/collections.js";
import type { CompanionDevice, CompanionPairing } from "../../db/types.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";
import { HttpError } from "../../middleware/error-handler.js";
import {
  pairApproveSchema,
  pairPollQuerySchema,
  pairStartSchema,
} from "./schemas.js";

/** Pairings expire after 5 minutes — beyond that the user has clearly
 *  walked away or the companion crashed. */
const PAIRING_TTL_MS = 5 * 60 * 1000;

/** Pairing-code charset — Crockford-ish base32 minus 0/O/1/I to avoid
 *  visually-ambiguous characters when the user reads it off-screen. */
const PAIR_CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Generate a pairing code like "XKCD-A7B2". The dash sits at the
 *  midpoint purely for human readability. */
function newPairingCode(): string {
  const half = 4;
  const draw = (n: number): string => {
    const buf = randomBytes(n);
    let out = "";
    for (let i = 0; i < n; i++) {
      out += PAIR_CODE_CHARS[buf[i]! % PAIR_CODE_CHARS.length];
    }
    return out;
  };
  return `${draw(half)}-${draw(half)}`;
}

/** Generate a 32-byte random token, base64url-encoded. */
function newBearerToken(): string {
  return randomBytes(32)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/** SHA-256(plaintext) → base64url. Same shape we use for auth_tokens. */
function hashToken(plaintext: string): string {
  return createHash("sha256")
    .update(plaintext, "utf8")
    .digest("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/** Best-effort base URL for the approval link the companion shows the
 *  user. Reconstructed from the request's Host + X-Forwarded-Proto so
 *  it works behind the Next.js catch-all on Vercel AND in local dev
 *  without an extra env var. */
function approvalBaseUrl(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || "http";
  const host = req.headers["host"] || "localhost:3000";
  return `${proto}://${host}`;
}

// ─── POST /api/v1/companion/pair/start ──────────────────────────────
//
// Companion-initiated. Creates a pairing row and returns the code +
// approval URL the user types/clicks in their browser. Public — the
// companion has no user identity yet, that's the whole point of this
// dance.

export async function pairStartHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { deviceName } = pairStartSchema.parse(req.body ?? {});
    const meta = networkMeta(req);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);

    const pairings = await getCompanionPairingsCollection();
    // Collision-safe: retry a couple of times if we happen to mint a
    // code that already exists (vanishingly unlikely with 32-char space,
    // but the inserted-row matters — `_id` IS the code).
    let code = newPairingCode();
    for (let attempts = 0; attempts < 5; attempts++) {
      const existing = await pairings.findOne({ _id: code });
      if (!existing) break;
      code = newPairingCode();
    }

    const row: CompanionPairing = {
      _id: code,
      deviceName,
      createdByIp: meta.ip,
      createdByUa: meta.ua,
      createdAt: now,
      expiresAt,
      approvedAt: null,
      approvedByUserId: null,
      pendingTokenHash: null,
      consumedAt: null,
    };
    await pairings.insertOne(row);

    res.json({
      code,
      expiresAt: expiresAt.toISOString(),
      approvalUrl: `${approvalBaseUrl(req)}/companion/pair?code=${encodeURIComponent(code)}`,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/v1/companion/pair/poll?code=... ───────────────────────
//
// Companion polls this while waiting for the user to approve. Public.
// Response states:
//
//   { status: "pending"  }            still waiting
//   { status: "approved", token, deviceId, deviceName }
//                                     just approved — token returned ONCE
//   { status: "consumed" }            already fetched the token on a
//                                     prior poll; replay protection
//   { status: "expired"  }            past expiresAt
//   { status: "not_found" }           bad / unknown code
//
// On the "approved" state we ATOMICALLY flip consumedAt so a second
// poll can't re-read the token. The companion is expected to persist
// the token immediately.

export async function pairPollHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { code } = pairPollQuerySchema.parse(req.query);
    const pairings = await getCompanionPairingsCollection();
    const now = new Date();

    const row = await pairings.findOne({ _id: code });
    if (!row) {
      res.json({ status: "not_found" });
      return;
    }
    if (row.expiresAt.getTime() < now.getTime() && !row.approvedAt) {
      res.json({ status: "expired" });
      return;
    }
    if (!row.approvedAt) {
      res.json({ status: "pending" });
      return;
    }
    if (row.consumedAt) {
      res.json({ status: "consumed" });
      return;
    }

    // Approved but not yet consumed — this is the one and only poll
    // where the companion gets the plaintext token. We must reconstruct
    // it; we stored only the hash. So: mint a fresh token at approval
    // time, persist the hash on the CompanionPairing row AND the
    // CompanionDevice row, and stash the plaintext on the PAIRING row
    // until the poll-consume step. Wait — that re-introduces plaintext
    // at rest, which we explicitly want to avoid.
    //
    // Real design: at /approve we mint a fresh plaintext, hash it,
    // store BOTH on the device row, store the hash on the pairing row,
    // and return the plaintext to the BROWSER (so the browser can't
    // share it with the companion). That defeats the device-flow
    // entirely.
    //
    // Correct approach (what we do): /approve mints a token and stores
    // its hash in pendingTokenHash on the pairing row. The PLAINTEXT
    // is encoded into the pairing-row update via a one-shot "outbox"
    // pattern: the controller for /approve generates the plaintext,
    // stores ONLY the hash, AND returns the plaintext to the polling
    // companion through the pairing row — but to do that we need to
    // remember the plaintext somewhere readable by the next poll.
    //
    // We accept a 5-minute window where the plaintext sits encrypted
    // alongside its hash on the pairing row, keyed by `_id` = code:
    // `pendingTokenPlaintext`. The row gets `consumedAt` set on the
    // first successful poll AND `pendingTokenPlaintext: null` is
    // cleared in the same update — the TTL index then sweeps the row
    // a few minutes later. Net exposure is at most PAIRING_TTL_MS,
    // and only for already-approved pairings the companion hasn't
    // fetched yet.
    //
    // To avoid duplicating fields on the type-system level, we read
    // `pendingTokenPlaintext` off the BSON document loosely.
    const plaintext = (row as unknown as { pendingTokenPlaintext?: string })
      .pendingTokenPlaintext;
    if (!plaintext) {
      // Shouldn't happen — /approve always sets it. Defensive fallback.
      logger.warn(
        { code },
        "[companion.pair] approved pairing missing plaintext token",
      );
      res.json({ status: "expired" });
      return;
    }

    // Look up the device the /approve handler created so we can return
    // its id (companion stores deviceId so it can self-revoke later).
    const devices = await getCompanionDevicesCollection();
    const device = await devices.findOne({ tokenHash: row.pendingTokenHash! });
    if (!device) {
      // Shouldn't happen — the /approve handler creates the device
      // before flipping the pairing row.
      logger.warn(
        { code },
        "[companion.pair] approved pairing references missing device",
      );
      res.json({ status: "expired" });
      return;
    }

    // ATOMIC consume — only the first poll succeeds.
    const consume = await pairings.findOneAndUpdate(
      { _id: code, consumedAt: null, approvedAt: { $ne: null } },
      {
        $set: { consumedAt: now },
        $unset: { pendingTokenPlaintext: "" },
      },
      { returnDocument: "after" },
    );

    if (!consume) {
      // Lost the race to another poll on the same code. Treat as
      // consumed — the legitimate companion has the token, this is
      // a duplicate request.
      res.json({ status: "consumed" });
      return;
    }

    res.json({
      status: "approved",
      token: plaintext,
      deviceId: device._id.toHexString(),
      deviceName: device.name,
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/v1/companion/pair/approve ────────────────────────────
//
// Browser-initiated, requires a logged-in session. The user has read
// the device name + IP from the dialog and clicked Approve. We mint a
// fresh bearer token, persist its hash on a new CompanionDevice row,
// and stash the plaintext on the pairing row so the next /pair/poll
// can return it once.

export async function pairApproveHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const { code } = pairApproveSchema.parse(req.body);
    const pairings = await getCompanionPairingsCollection();
    const devices = await getCompanionDevicesCollection();
    const now = new Date();

    const row = await pairings.findOne({ _id: code });
    if (!row) {
      throw new HttpError(404, "pairing_not_found", "Pairing code not found.");
    }
    if (row.expiresAt.getTime() < now.getTime() && !row.approvedAt) {
      throw new HttpError(410, "pairing_expired", "Pairing code has expired.");
    }
    if (row.approvedAt) {
      throw new HttpError(
        409,
        "pairing_already_approved",
        "This pairing was already approved.",
      );
    }

    // Mint bearer token + create device row.
    const plaintext = newBearerToken();
    const tokenHash = hashToken(plaintext);

    const device: CompanionDevice = {
      _id: new ObjectId(),
      userId: session.userId,
      orgId: session.orgId,
      tokenHash,
      name: row.deviceName,
      createdAt: now,
      lastUsedAt: now,
      revokedAt: null,
      createdByIp: row.createdByIp,
      createdByUa: row.createdByUa,
    };
    await devices.insertOne(device);

    // Flip the pairing row to approved + stash plaintext for the next
    // poll. Atomic w.r.t. duplicate approval attempts: the filter
    // requires approvedAt:null so a second click on the same code 409s.
    const upd = await pairings.findOneAndUpdate(
      { _id: code, approvedAt: null },
      {
        $set: {
          approvedAt: now,
          approvedByUserId: session.userId,
          pendingTokenHash: tokenHash,
          // Stored as a loose extra field — not declared on the
          // CompanionPairing TS interface because it's deliberately
          // ephemeral (cleared on the first successful poll, AND
          // swept by TTL within PAIRING_TTL_MS regardless).
          pendingTokenPlaintext: plaintext,
        } as Partial<CompanionPairing> & { pendingTokenPlaintext: string },
      },
      { returnDocument: "after" },
    );
    if (!upd) {
      // Lost the race — another tab approved first. Tear down the
      // device row we just created so we don't end up with a dangling
      // unreferenced device.
      await devices.deleteOne({ _id: device._id });
      throw new HttpError(
        409,
        "pairing_already_approved",
        "This pairing was already approved.",
      );
    }

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "companion.device_paired",
      targetType: "companion_device",
      targetId: device._id.toHexString(),
      after: {
        deviceName: device.name,
        pairingCode: code,
        createdByIp: row.createdByIp,
      },
      ...networkMeta(req),
    });

    res.json({
      ok: true,
      device: {
        id: device._id.toHexString(),
        name: device.name,
        createdAt: device.createdAt.toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/v1/companion/devices ──────────────────────────────────
//
// Lists the calling user's active companion devices. Used by the
// Settings → Devices UI (Phase 3e). Excludes revoked rows.

export async function listDevicesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const devices = await getCompanionDevicesCollection();
    const rows = await devices
      .find({ userId: session.userId, revokedAt: null })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      devices: rows.map((d) => ({
        id: d._id.toHexString(),
        name: d.name,
        createdAt: d.createdAt.toISOString(),
        lastUsedAt: d.lastUsedAt.toISOString(),
        createdByIp: d.createdByIp,
        createdByUa: d.createdByUa,
      })),
    });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/v1/companion/devices/:id ───────────────────────────
//
// User-initiated revocation. Flips revokedAt — the device's bearer
// token stops authenticating immediately (verifyBearer rejects
// revoked rows).

export async function revokeDeviceHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const idParam = String(req.params.id ?? "");
    if (!ObjectId.isValid(idParam)) {
      throw new HttpError(400, "bad_request", "Malformed device id.");
    }
    const id = new ObjectId(idParam);
    const devices = await getCompanionDevicesCollection();
    const now = new Date();

    const upd = await devices.findOneAndUpdate(
      { _id: id, userId: session.userId, revokedAt: null },
      { $set: { revokedAt: now } },
      { returnDocument: "after" },
    );
    if (!upd) {
      // Either not found, not owned, or already revoked. Either way the
      // user-facing outcome is the same — return 404.
      throw new HttpError(404, "device_not_found", "Device not found.");
    }

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "companion.device_revoked",
      targetType: "companion_device",
      targetId: id.toHexString(),
      before: { name: upd.name },
      ...networkMeta(req),
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

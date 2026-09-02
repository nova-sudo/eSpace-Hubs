/**
 * Companion-routing resolver — given an HTTP request, returns the
 * companion-tunnel origin to proxy to, or null when the request
 * should be served by the bundled API.
 *
 * Used by the Vercel catch-all (`apps/web/src/pages/api/v1/[...path].ts`)
 * to dispatch /api/v1/* traffic to a user's personal companion when
 * one is registered + fresh. Lives in @espace-devhub/api because:
 *
 *   1. It needs the same SESSION_SECRET + session-lookup logic the
 *      auth module uses.
 *   2. The catch-all already imports from @espace-devhub/api for
 *      buildApp() — colocating this helper means one dynamic import,
 *      one warm-container cost.
 *
 * Security model
 * ──────────────
 * We do a FULL server-side lookup (no header trust) so a malicious
 * client can't redirect their requests to another user's tunnel:
 *
 *   1. Read the signed session cookie from the raw Cookie header
 *   2. Verify the signature with SESSION_SECRET
 *   3. Look up the session in Mongo → get userId
 *   4. Look up the user → read their companionTunnel.hostname
 *   5. Check the registration is fresh (last heartbeat < 5 min)
 *
 * If all five succeed, return `https://<hostname>`. Otherwise null.
 *
 * Performance: this is a 2-doc Mongo read (session + user) per
 * request that has a session cookie. Both are indexed lookups by
 * primary key; in p50 should add <5ms. Cold-start on a serverless
 * container is dominated by the buildApp() compile + first Mongo
 * connect, not this helper.
 */

import type { IncomingHttpHeaders } from "node:http";
import { parse as parseCookieHeader } from "cookie";
import { unsign } from "cookie-signature";
import { env } from "../config/env.js";
import { lookupSession } from "../modules/auth/session.js";
import { SESSION_COOKIE_NAME } from "../modules/auth/cookies.js";
import { getUsersCollection } from "../db/collections.js";
import { logger } from "./logger.js";

const COMPANION_STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Structural minimum this resolver needs: something with request
 * headers. Deliberately NOT `IncomingMessage` — the two callers are
 * Express's `Request` and Next's `NextApiRequest`, which both extend it
 * but with mutually incompatible augmentations (pino-http narrows `id`
 * to `ReqId` on Express's, so it isn't assignable to a plain
 * `IncomingMessage` parameter). Asking only for what we read keeps both
 * call sites type-safe without a cast.
 */
export interface CompanionRoutingRequest {
  headers: IncomingHttpHeaders;
}

export interface CompanionRouting {
  /** Tunnel origin to proxy to, or null to serve locally. */
  origin: string | null;
  /** Set when the user HAS a companion but its heartbeat went stale —
   *  callers decide whether "serve locally" is honest for the route. */
  staleHostname: string | null;
}

/** Origin-only view — the shape both proxies historically consumed. */
export async function resolveCompanionOrigin(
  req: CompanionRoutingRequest,
): Promise<string | null> {
  return (await resolveCompanionRouting(req)).origin;
}

export async function resolveCompanionRouting(
  req: CompanionRoutingRequest,
): Promise<CompanionRouting> {
  const local: CompanionRouting = { origin: null, staleHostname: null };
  try {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader || typeof cookieHeader !== "string") return local;

    const cookies = parseCookieHeader(cookieHeader);
    const raw = cookies[SESSION_COOKIE_NAME];
    if (!raw) return local;

    // Express's signed cookies are stored with an "s:" prefix on the
    // value followed by a "." separator and the HMAC signature. We
    // strip the prefix and unsign to recover the original sessionId.
    if (!raw.startsWith("s:")) return local;
    const unsigned = unsign(raw.slice(2), env.SESSION_SECRET);
    if (!unsigned) return local;

    const session = await lookupSession(unsigned);
    if (!session) return local;

    const users = await getUsersCollection();
    const user = await users.findOne(
      { _id: session.userId },
      { projection: { companionTunnel: 1 } },
    );
    const tunnel = user?.companionTunnel;
    if (!tunnel || !tunnel.hostname) return local;

    const ageMs = Date.now() - new Date(tunnel.lastSeenAt).getTime();
    if (ageMs >= COMPANION_STALE_AFTER_MS) {
      // Worth a line: the user has a companion registered but we're
      // about to serve them from the deployed backend anyway. Silent,
      // this is indistinguishable from "no companion" — and it's the
      // state the UI keeps calling "companion" because the header chip
      // reads the same row without the freshness check.
      logger.debug(
        {
          userId: session.userId.toHexString(),
          hostname: tunnel.hostname,
          staleForMs: ageMs - COMPANION_STALE_AFTER_MS,
        },
        "[companion-routing] registration is stale — serving locally",
      );
      return { origin: null, staleHostname: tunnel.hostname };
    }

    return { origin: `https://${tunnel.hostname}`, staleHostname: null };
  } catch (err) {
    // Defensive: ANY failure during routing resolution falls through to
    // serving the request here. A transient Mongo blip must not 500 a
    // request that this process is perfectly able to answer.
    //
    // Log it — swallowing this silently is precisely why a whole
    // deployment's worth of companion routing could be dead without a
    // single symptom in the logs.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[companion-routing] resolution threw — falling back to local",
    );
    return local;
  }
}

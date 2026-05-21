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

import type { IncomingMessage } from "node:http";
import { parse as parseCookieHeader } from "cookie";
import { unsign } from "cookie-signature";
import { env } from "../config/env.js";
import { lookupSession } from "../modules/auth/session.js";
import { SESSION_COOKIE_NAME } from "../modules/auth/cookies.js";
import { getUsersCollection } from "../db/collections.js";

const COMPANION_STALE_AFTER_MS = 5 * 60 * 1000;

export async function resolveCompanionOrigin(
  req: IncomingMessage,
): Promise<string | null> {
  try {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader || typeof cookieHeader !== "string") return null;

    const cookies = parseCookieHeader(cookieHeader);
    const raw = cookies[SESSION_COOKIE_NAME];
    if (!raw) return null;

    // Express's signed cookies are stored with an "s:" prefix on the
    // value followed by a "." separator and the HMAC signature. We
    // strip the prefix and unsign to recover the original sessionId.
    if (!raw.startsWith("s:")) return null;
    const unsigned = unsign(raw.slice(2), env.SESSION_SECRET);
    if (!unsigned) return null;

    const session = await lookupSession(unsigned);
    if (!session) return null;

    const users = await getUsersCollection();
    const user = await users.findOne(
      { _id: session.userId },
      { projection: { companionTunnel: 1 } },
    );
    const tunnel = user?.companionTunnel;
    if (!tunnel || !tunnel.hostname) return null;

    const ageMs = Date.now() - new Date(tunnel.lastSeenAt).getTime();
    if (ageMs >= COMPANION_STALE_AFTER_MS) return null;

    return `https://${tunnel.hostname}`;
  } catch {
    // Defensive: ANY failure during routing resolution falls through
    // to the bundled API. We never want a transient Mongo blip to
    // 500 the whole catch-all just because the companion lookup
    // didn't succeed.
    return null;
  }
}

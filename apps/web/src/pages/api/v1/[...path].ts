/**
 * /api/v1/* catch-all — forwards every request to the Express app
 * built by `@espace-devhub/api/serverless`.
 *
 * Why Pages Router (not App Router)
 * ─────────────────────────────────
 * Express's middleware chain expects Node's `IncomingMessage` /
 * `ServerResponse` types — it reads from `req.url`, `req.headers`,
 * pushes to `res.write()` / `res.end()`, etc. Next's Pages Router
 * hands the handler those exact Node types directly
 * (`NextApiRequest extends IncomingMessage`, `NextApiResponse extends
 * ServerResponse`). The App Router's Web-fetch-style `Request` and
 * `Response` are NOT compatible with Express without a manual
 * adapter layer.
 *
 * App Router + Pages Router can coexist in the same Next.js project.
 * Our only App-Router API route today is
 * `/api/oauth/github/exchange`; this catch-all owns `/api/v1/*` and
 * nothing else.
 *
 * Cold-start vs. warm-invocation
 * ──────────────────────────────
 * Vercel may keep a function container warm for a few minutes
 * between requests. We cache the Express app on a module-level
 * Promise so warm calls reuse it (and its Mongo connection pool).
 * Cold starts pay the full price: one `buildApp()` (sync), then a
 * background `connect()` → `bootstrap()` → `seedDefaultOrg()`
 * pipeline that primes Mongo. Routes that touch Mongo via `getDb()`
 * await the same in-flight `connect()` promise — see
 * `apps/api/src/db/client.ts`.
 *
 * Body parsing + response handling
 * ────────────────────────────────
 *   - `bodyParser: false` — Express's own parsers consume the raw
 *     body. Without this Next would parse first and Express would
 *     get an empty stream.
 *   - `responseLimit: false` — disables Next's 4MB default response
 *     cap. The classify-goals NDJSON stream + audit-log responses
 *     can exceed that on long sessions. Vercel still enforces its
 *     own function-execution + payload limits at the platform
 *     layer.
 *   - `externalResolver: true` — silences Next's
 *     "API resolved without sending a response" warning. We DO send
 *     a response, but asynchronously via Express; Next's heuristic
 *     can't tell.
 *
 * Streaming caveat on Vercel
 * ──────────────────────────
 * Vercel function-execution caps depend on plan:
 *   - Hobby: 10 s per invocation (NDJSON streams cut off)
 *   - Pro:   60 s for streaming responses
 *   - Enterprise: configurable up to 900 s
 * `/api/v1/ai/classify-goals` and `/api/v1/ai/grade-pr` are the
 * streamiest endpoints. If you're on Hobby and seeing classifier
 * timeouts, the fix is to refactor that route to a client-driven
 * fan-out (one short request per goal) — see the migration notes
 * in the README for instructions.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import type { Application } from "express";
import type { IncomingMessage } from "node:http";
import https from "node:https";

let appPromise: Promise<Application> | null = null;
let resolveCompanionOrigin:
  | ((req: IncomingMessage) => Promise<string | null>)
  | null = null;

// Hop-by-hop headers per RFC 7230 §6.1 — these MUST NOT be forwarded
// when proxying. The rest of the request headers (including the
// session Cookie) pass through unchanged so the companion's API sees
// the same authenticated request the browser sent.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  // Vercel-injected headers — the companion has no use for them and
  // some confuse cookie/CSP middleware downstream.
  "host",
  "x-vercel-id",
  "x-vercel-deployment-url",
  "x-vercel-forwarded-for",
  "x-vercel-ip-city",
  "x-vercel-ip-country",
  "x-vercel-ip-country-region",
  "x-vercel-ip-latitude",
  "x-vercel-ip-longitude",
  "x-vercel-ip-timezone",
  "x-vercel-ip-as-number",
  "x-vercel-ip-continent",
  "x-vercel-proxied-for",
  "x-vercel-proxy-signature",
  "x-vercel-proxy-signature-ts",
  "x-vercel-sc-basepath",
  "x-vercel-sc-headers",
  "x-vercel-sc-host",
  "x-vercel-enable-rewrite-caching",
  "x-vercel-internal-timing",
  "x-vercel-oidc-token",
  "x-vercel-ja4-digest",
  "x-vercel-ept",
  "x-matched-path",
  "x-real-ip",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "forwarded",
  "x-invocation-id",
]);

function filterHeaders(
  headers: NextApiRequest["headers"],
  targetHost: string,
): Record<string, string> {
  const out: Record<string, string> = { host: targetHost };
  for (const [k, v] of Object.entries(headers)) {
    if (v == null) continue;
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    out[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

function proxyToCompanion(
  req: NextApiRequest,
  res: NextApiResponse,
  origin: string,
): Promise<void> {
  const target = new URL(req.url || "/", origin);
  return new Promise((resolve) => {
    const proxyReq = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method: req.method,
        headers: filterHeaders(req.headers, target.hostname),
      },
      (proxyRes) => {
        // Forward all upstream headers verbatim. Notably Set-Cookie
        // (if the companion mints a session) flows back to the
        // browser; the browser scopes it to espace-hubs.vercel.app
        // because the response comes from there, not the tunnel
        // hostname directly.
        const headers = { ...proxyRes.headers };
        for (const k of Object.keys(headers)) {
          if (HOP_BY_HOP.has(k.toLowerCase())) delete headers[k];
        }
        res.writeHead(proxyRes.statusCode || 502, headers);
        proxyRes.pipe(res);
        proxyRes.on("end", () => resolve());
        proxyRes.on("error", () => resolve());
      },
    );
    proxyReq.on("error", (err) => {
      // Companion unreachable — surface a clear error so the frontend
      // can show "open your companion." We DON'T fall back to the
      // bundled API here because the bundled API can't fetch from the
      // user's private upstreams anyway (that was the whole reason
      // we routed to the companion). A bundled response would just
      // produce broken tile data and confuse the user.
      // eslint-disable-next-line no-console
      console.warn("[catch-all] companion proxy failed:", err.message);
      if (!res.headersSent) {
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            error: {
              code: "companion_unreachable",
              message: `Couldn't reach your companion at ${target.hostname}: ${err.message}. Open the companion app and try again.`,
            },
          }),
        );
      }
      resolve();
    });
    // Stream the request body through — handles large bodies +
    // streaming uploads without buffering everything in memory.
    req.pipe(proxyReq);
    req.on("error", () => proxyReq.destroy());
  });
}

async function getApp(): Promise<Application> {
  if (!appPromise) {
    appPromise = (async () => {
      // Dynamic import so the module graph stays small for any
      // request that doesn't touch this route (Next still bundles
      // it into the function, but the import isn't evaluated until
      // the first /api/v1/* hit on a fresh container).
      const mod = await import("@espace-devhub/api");
      const app = mod.buildApp();
      // Phase 3: capture the companion-routing resolver so we can
      // ask it on every request whether to proxy instead.
      resolveCompanionOrigin = mod.resolveCompanionOrigin;
      // Kick off the Mongo + bootstrap pipeline in the background.
      // We don't `await` it here so the first request can start
      // processing immediately — any handler that needs the DB
      // awaits the same in-flight `connect()` singleton via
      // `getDb()` (see apps/api/src/db/client.ts).
      void mod
        .connect()
        .then(() => mod.bootstrap())
        .then(() => mod.seedDefaultOrg())
        .catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.warn(
            "[boot] serverless mongo bootstrap failed:",
            err instanceof Error ? err.message : String(err),
          );
        });
      return app;
    })();
  }
  return appPromise;
}

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
    externalResolver: true,
  },
};

/**
 * Path prefixes that MUST always hit Vercel's bundled API, never the
 * companion tunnel — regardless of whether the user has a fresh
 * registration. Two failure modes drove this list:
 *
 *   1. Dead tunnel masks core endpoints. If the user's cloudflared
 *      stops sending heartbeats but the registration is still inside
 *      the 5-minute freshness window, a POST /auth/login would 530
 *      via CF Tunnel error 1033 — the user can't sign in to fix it
 *      from the same browser.
 *
 *   2. Circular routing. The /companion/* pairing endpoints and
 *      /auth/me/companion-tunnel + /auth/me/api-origin ARE the
 *      routing-management surface. Proxying them to a companion is
 *      either circular ("ask the companion where the companion is")
 *      or pointless (the companion doesn't know about the pairing
 *      flow because the pairing collection lives only in the
 *      Vercel-side Mongo).
 *
 * The integration-proxy endpoints (/integrations/proxy/<provider>/*)
 * stay proxied — those are the entire reason companions exist
 * (upstream calls to private resources behind the user's VPN).
 */
function shouldBypassCompanion(rawUrl: string): boolean {
  // Strip query string — we're only matching on the path.
  const path = rawUrl.split("?", 1)[0] || "";
  return (
    path.startsWith("/api/v1/auth/") ||
    path.startsWith("/api/v1/admin/") ||
    path.startsWith("/api/v1/companion/")
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  const app = await getApp();

  // Phase 3 routing decision — does this user have a fresh companion
  // tunnel registered? If yes, proxy the whole request there and skip
  // the bundled Express app entirely. The resolver does a Mongo
  // lookup keyed by the user's session; on null we fall through to
  // the bundled path, preserving today's behavior for the 99% of
  // users (and 100% of unauthenticated requests).
  //
  // Hard-bypass for auth/admin/companion-pairing paths — see
  // `shouldBypassCompanion` above for why. Even if the user has a
  // fresh companion registration, these endpoints must hit Vercel.
  if (resolveCompanionOrigin && !shouldBypassCompanion(req.url || "")) {
    try {
      const origin = await resolveCompanionOrigin(req);
      if (origin) {
        return proxyToCompanion(req, res, origin);
      }
    } catch (err) {
      // Routing decision MUST be non-fatal — if Mongo is briefly
      // unreachable for the resolver, we still want to serve the
      // request via the bundled app rather than 500.
      // eslint-disable-next-line no-console
      console.warn(
        "[catch-all] companion-routing resolution failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Next pre-parses cookies onto `req.cookies` before handing the
  // request to us. Express's `cookie-parser` short-circuits when it
  // sees an existing `req.cookies`:
  //
  //     if (req.cookies) return next();
  //
  // …which means it never sets `req.secret` or `req.signedCookies`.
  // That breaks signed-cookie writes (`res.cookie(..., { signed: true })`
  // throws `cookieParser("secret") required for signed cookies`) and
  // signed-cookie reads (the session middleware sees an empty
  // `req.signedCookies`). Clear Next's pre-parse so cookie-parser
  // re-parses from the raw `Cookie` header and wires everything up.
  delete (req as unknown as { cookies?: unknown }).cookies;
  delete (req as unknown as { signedCookies?: unknown }).signedCookies;

  // Express writes to res asynchronously; wrap the call in a promise
  // that settles when the response is fully sent (either normal
  // `finish` or premature `close`). Without this, Next would resolve
  // the function before Express finishes streaming, leaving the
  // client with a truncated body on Vercel.
  return new Promise<void>((resolve) => {
    res.on("close", () => resolve());
    res.on("finish", () => resolve());
    app(req, res);
  });
}

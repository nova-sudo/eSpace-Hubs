/**
 * Companion routing — proxies a request to the caller's personal
 * companion tunnel instead of serving it from this process.
 *
 * Why this lives in apps/api (and no longer only in apps/web)
 * ──────────────────────────────────────────────────────────
 * This logic used to exist ONLY inside the Vercel catch-all
 * (`apps/web/src/pages/api/v1/[...path].ts`). That worked while the API
 * was bundled into the Next.js deploy. It does not work on the split
 * Coolify topology (docs/deployment-coolify.md), because the web tier
 * sets `API_ORIGIN`, and `next.config.mjs` then registers a
 * `beforeFiles` rewrite for `/api/v1/:path*` — which by design runs
 * BEFORE Next's file-based routing and forwards straight to the `api`
 * container. The catch-all is never reached, so nothing ever consulted
 * `resolveCompanionOrigin` and 100% of traffic was served by the
 * deployed backend.
 *
 * The failure was silent in the worst way: the heartbeat still wrote
 * `user.companionTunnel` (its POST is rewritten to this container like
 * any other call), `/auth/me/api-origin` still read that row back and
 * answered `source: "companion"`, and the header chip still went green.
 * The UI reported routing was live while nothing routed.
 *
 * Mounting the decision here fixes every topology at once — bundled
 * (Vercel), split (Coolify), compose, and plain `npm run dev` — because
 * this Express app is the one component all of them funnel through. It
 * is also the process that already holds what the decision needs: the
 * Mongo connection and `SESSION_SECRET`.
 *
 * Loop guard (REQUIRED — read before removing)
 * ────────────────────────────────────────────
 * The companion runs THIS SAME Express app on the user's laptop. A
 * proxied request arrives there carrying the user's session cookie, so
 * without a guard the local instance would resolve the very same
 * companion origin and proxy the request to itself, forever. Every hop
 * stamps `x-devhub-companion-hop`; seeing it means "you are the
 * companion, serve this yourself." A client can forge the header, but
 * the only thing that buys them is being served by the deployed backend
 * — which is the default anyway — so it is not a privilege boundary.
 *
 * Mount position
 * ──────────────
 * Must be mounted BEFORE `express.json()` / `express.urlencoded()`.
 * Those consume the request stream, and this middleware pipes the raw
 * body to the companion; a parsed body would arrive empty. That also
 * puts it ahead of `pino-http`, so proxied requests are logged here
 * explicitly instead of by the usual request logger.
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import https from "node:https";
import http from "node:http";
import { resolveCompanionOrigin } from "../lib/companion-routing.js";
import { logger } from "../lib/logger.js";

/**
 * Marks a request as already having been proxied once. Presence means
 * "this process IS the companion" — serve locally, never re-proxy.
 */
export const COMPANION_HOP_HEADER = "x-devhub-companion-hop";

/**
 * Hop-by-hop headers per RFC 7230 §6.1 — never forwarded by a proxy.
 *
 * `origin` is in this list on purpose, and it is NOT a hop-by-hop
 * header. The hop is server-to-server: the browser is talking to the
 * web tier same-origin and never inspects the companion's CORS headers,
 * so forwarding the browser's `Origin` achieves nothing — while the
 * companion's own CORS check (see app.ts) would reject an origin its
 * local `CORS_ALLOWED_ORIGINS` doesn't list. Dropping it here means a
 * companion works regardless of how its local CORS is configured.
 *
 * `host` is dropped because the proxy sets its own (the tunnel
 * hostname); the `x-forwarded-*` family is dropped because it describes
 * the hop the companion is not part of.
 */
const STRIPPED_REQUEST_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "origin",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "forwarded",
  "x-real-ip",
]);

/** Same list minus the request-only entries, applied to the response. */
const STRIPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Paths that MUST always be served by the deployed backend, never
 * proxied — carried over verbatim from the Vercel catch-all, for the
 * same two reasons:
 *
 *   1. A dead tunnel must not be able to mask core endpoints. If the
 *      registration is still inside its freshness window but the tunnel
 *      is gone, a proxied `POST /auth/login` would fail and the user
 *      couldn't sign in to fix it from the same browser.
 *   2. `/companion/*` and `/auth/me/{companion-tunnel,api-origin}` ARE
 *      the routing-management surface. Proxying them is either circular
 *      ("ask the companion where the companion is") or pointless — the
 *      pairing rows live only in the deployed Mongo.
 *
 * `/integrations/*` deliberately stays proxied. Reaching private
 * upstreams from the user's own network is the entire reason companions
 * exist.
 */
function shouldBypassCompanion(rawUrl: string): boolean {
  const path = rawUrl.split("?", 1)[0] || "";
  return (
    path.startsWith("/api/v1/auth/") ||
    path.startsWith("/api/v1/admin/") ||
    path.startsWith("/api/v1/companion/")
  );
}

function forwardedRequestHeaders(
  req: Request,
  targetHost: string,
): Record<string, string> {
  const out: Record<string, string> = { host: targetHost };
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    if (STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  out[COMPANION_HOP_HEADER] = "1";
  return out;
}

function proxyToCompanion(
  req: Request,
  res: Response,
  origin: string,
): Promise<void> {
  const target = new URL(req.originalUrl || req.url || "/", origin);
  const transport = target.protocol === "http:" ? http : https;
  const defaultPort = target.protocol === "http:" ? 80 : 443;

  return new Promise((resolve) => {
    const proxyReq = transport.request(
      {
        hostname: target.hostname,
        port: target.port || defaultPort,
        path: target.pathname + target.search,
        method: req.method,
        headers: forwardedRequestHeaders(req, target.hostname),
      },
      (proxyRes) => {
        const headers = { ...proxyRes.headers };
        for (const key of Object.keys(headers)) {
          if (STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) {
            delete headers[key];
          }
        }
        res.writeHead(proxyRes.statusCode || 502, headers);
        proxyRes.pipe(res);
        proxyRes.on("end", () => resolve());
        proxyRes.on("error", () => resolve());
      },
    );

    proxyReq.on("error", (err) => {
      // The companion is unreachable. We deliberately DON'T fall back to
      // serving this locally: the whole reason the request was routed
      // there is that this process can't reach the user's private
      // upstreams, so a local answer would be confidently wrong data
      // rather than an honest error. The web client turns this specific
      // code into a single "Companion offline" toast — see
      // apps/web/src/lib/api-client.js.
      logger.warn(
        {
          host: target.hostname,
          method: req.method,
          path: target.pathname,
          err: err.message,
        },
        "[companion-proxy] companion unreachable",
      );
      if (!res.headersSent) {
        res.status(502).json({
          error: {
            code: "companion_unreachable",
            message: `Couldn't reach your companion at ${target.hostname}: ${err.message}. Open the companion app and try again.`,
          },
        });
      }
      resolve();
    });

    req.pipe(proxyReq);
    req.on("error", () => proxyReq.destroy());
  });
}

/**
 * Express middleware. Calls `next()` for everything it doesn't route,
 * so a request that isn't companion-bound costs one indexed session
 * lookup and nothing else.
 */
export function companionProxy(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.headers[COMPANION_HOP_HEADER]) return next(); // we ARE the companion
    if (shouldBypassCompanion(req.originalUrl || req.url || "")) return next();

    void resolveCompanionOrigin(req)
      .then((origin) => {
        if (!origin) return next();
        logger.debug(
          { method: req.method, path: req.path, origin },
          "[companion-proxy] routing to companion",
        );
        return proxyToCompanion(req, res, origin);
      })
      .catch((err: unknown) => {
        // Routing resolution must never be fatal — a transient Mongo
        // blip should degrade to "serve it here", not 500 the request.
        // resolveCompanionOrigin already swallows its own errors, so
        // reaching this branch means something unexpected happened.
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "[companion-proxy] routing resolution failed — serving locally",
        );
        next();
      });
  };
}

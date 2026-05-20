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

let appPromise: Promise<Application> | null = null;

async function getApp(): Promise<Application> {
  if (!appPromise) {
    appPromise = (async () => {
      // Dynamic import so the module graph stays small for any
      // request that doesn't touch this route (Next still bundles
      // it into the function, but the import isn't evaluated until
      // the first /api/v1/* hit on a fresh container).
      const mod = await import("@espace-devhub/api");
      const app = mod.buildApp();
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  const app = await getApp();

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

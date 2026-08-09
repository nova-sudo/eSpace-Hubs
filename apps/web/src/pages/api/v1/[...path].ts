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
 * Companion routing is NOT here
 * ─────────────────────────────
 * This file used to own the "proxy this user's request to their
 * companion tunnel" decision. It doesn't any more — that lives in
 * `apps/api/src/middleware/companion-proxy.ts`, mounted inside the
 * Express app this route invokes.
 *
 * The move was forced by the split Coolify topology
 * (docs/deployment-coolify.md): the web tier sets `API_ORIGIN`, which
 * makes `next.config.mjs` register a `beforeFiles` rewrite for
 * `/api/v1/:path*`. That rewrite runs BEFORE file-based routing, so
 * this file never executes there at all — and companion routing was
 * silently dead for every user on that deploy. Keeping a second copy
 * here would just mean two implementations that drift.
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

      // Await the Mongo + bootstrap pipeline BEFORE returning the
      // app. Earlier this was fire-and-forget so the first request
      // could start immediately — but that races schema-changing
      // deploys: any deploy that removes a `required` field from a
      // validator (e.g. the demo-mode removal) leaves Mongo still
      // requiring the old field until `bootstrap()` runs
      // `collMod`. Requests that landed in that window failed
      // validation on insert ("missingProperties: [demo]").
      //
      // Cost of awaiting: cold-start latency goes up by the
      // duration of bootstrap (~1-2s on Atlas — validator alignment
      // + index ensure + boot-time migrations). Warm invocations
      // still hit the cached appPromise and pay nothing. Worth it
      // for correctness.
      try {
        await mod.connect();
        await mod.bootstrap();
        await mod.seedDefaultOrg();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          "[boot] serverless mongo bootstrap failed:",
          err instanceof Error ? err.message : String(err),
        );
        // We DON'T reset appPromise on failure — the next request
        // would just retry the failing path. Better: serve the app
        // so handlers can surface a clean 500 with a logged cause.
        // The retry happens on the next cold start (new container)
        // which is the right scope.
      }

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
  // Lift the function-execution cap to 60s (Pro/Enterprise) so slow
  // upstream integrations — Crealogix's self-hosted GitLab takes
  // ~20–40s to scan a 60-day `updated_after` window for heavy
  // authors — finish inside the function lifetime instead of getting
  // killed mid-flight and returning an empty 502. Hobby plans cap at
  // 10s regardless of this setting; on Pro it's honoured up to 60s,
  // and Enterprise up to 900s. The companion-side proxy.ts now
  // aborts its own fetch at 45s with a 504 `integration_timeout`
  // so the user sees a clear error rather than a bare 502.
  maxDuration: 60,
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

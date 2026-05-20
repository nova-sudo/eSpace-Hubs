/**
 * Serverless entry point — re-exports the Express factory + the
 * lazy-init helpers that the Vercel catch-all adapter needs.
 *
 * Why a dedicated barrel
 * ──────────────────────
 * `apps/api/src/server.ts` is the long-running boot path: it builds
 * the app, listens on a port, wires graceful shutdown. None of that
 * makes sense in a serverless invocation — Vercel calls our handler
 * once per request, then the container hibernates between calls.
 *
 * The catch-all (`apps/web/src/pages/api/v1/[...path].ts`) needs:
 *   - `buildApp()` — sync factory; produces an Express Application
 *     that can be invoked as `app(req, res)` per request.
 *   - `connect()` + `bootstrap()` + `seedDefaultOrg()` — the same
 *     boot pipeline `server.ts` runs once, but called from the
 *     adapter on first cold start so each fresh container primes
 *     its Mongo pool + ensures collection validators + indexes.
 *
 * Keeping the surface narrow lets the consumer (apps/web) drop a
 * stable import path into the adapter without reaching into
 * `db/*` directly.
 */

export { buildApp } from "./app.js";
export { connect, disconnect, getDb } from "./db/client.js";
export { bootstrap } from "./db/collections.js";
export { seedDefaultOrg } from "./db/seed.js";

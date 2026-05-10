/**
 * Server bootstrap. Builds the Express app, kicks off a non-blocking
 * Mongo connect (so /readyz turns green as soon as Mongo's reachable),
 * and starts listening.
 *
 * Graceful shutdown:
 *   - SIGTERM / SIGINT triggers a 10s drain window
 *   - During drain we stop accepting new connections, finish in-flight
 *     requests, then close the Mongo pool
 *   - If the drain exceeds the deadline we exit non-zero so orchestrators
 *     escalate
 */

import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { connect, disconnect } from "./db/client.js";
import { ensureIndexes } from "./db/collections.js";

const SHUTDOWN_DEADLINE_MS = 10_000;

async function main(): Promise<void> {
  const app = buildApp();

  // Non-blocking — the HTTP server starts even if Mongo is unreachable.
  // /readyz reports the truth so probes stay accurate.
  void connect()
    .then(() => ensureIndexes())
    .catch((err) => {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "[boot] mongo not reachable yet — service is up; readyz will fail until mongo is available",
      );
    });

  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV },
      `[boot] api listening on :${env.PORT}`,
    );
  });

  // ─── graceful shutdown ────────────────────────────────────────────
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "[shutdown] draining…");

    const deadline = setTimeout(() => {
      logger.error("[shutdown] drain timed out — forcing exit");
      process.exit(1);
    }, SHUTDOWN_DEADLINE_MS);
    deadline.unref();

    server.close(async (err) => {
      if (err) {
        logger.error({ err: err.message }, "[shutdown] server close error");
      }
      try {
        await disconnect();
      } catch (e) {
        logger.error(
          { err: e instanceof Error ? e.message : String(e) },
          "[shutdown] mongo disconnect error",
        );
      }
      logger.info("[shutdown] done");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Last-resort logging — whoever wires this to a process supervisor
  // will want stack traces, not silent crashes.
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ reason }, "[fatal] unhandledRejection");
  });
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "[fatal] uncaughtException");
    // After uncaught — bail. The orchestrator will restart us.
    process.exit(1);
  });
}

main().catch((err) => {
  logger.fatal({ err }, "[boot] fatal startup error");
  process.exit(1);
});

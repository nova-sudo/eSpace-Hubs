/**
 * Mongo client wrapper.
 *
 * Connection model: a single MongoClient lives for the process lifetime.
 * `connect()` is idempotent and resolves once Mongo accepts a `ping`.
 * `getDb()` returns the typed Db handle once connected.
 *
 * Design note — connection is LAZY by intent. The HTTP server starts
 * regardless of Mongo's state so that container orchestrators see the
 * service come up fast; /readyz reports the truth about Mongo so probes
 * stay accurate.
 */

import { MongoClient, type Db, type MongoClientOptions } from "mongodb";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

const clientOptions: MongoClientOptions = {
  // Conservative pool — Atlas free tier maxes at 100 connections; one
  // app instance with 50 leaves room for migrations / scripts to run
  // alongside the service. Adjust per environment in M-later.
  maxPoolSize: 50,
  minPoolSize: 0,
  serverSelectionTimeoutMS: 5_000,
  connectTimeoutMS: 5_000,
};

let client: MongoClient | null = null;
let connecting: Promise<MongoClient> | null = null;
let lastError: Error | null = null;

function newClient(): MongoClient {
  return new MongoClient(env.MONGO_URI, clientOptions);
}

/**
 * Connect (or reuse the existing connection). Idempotent and concurrency-safe
 * — multiple callers during boot share one in-flight Promise.
 */
export async function connect(): Promise<MongoClient> {
  if (client) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    const c = newClient();
    try {
      await c.connect();
      // Force a round-trip so we discover credential / network failures
      // here instead of on the first real query.
      await c.db(env.MONGO_DB_NAME).command({ ping: 1 });
      client = c;
      lastError = null;
      logger.info(
        { db: env.MONGO_DB_NAME },
        "[db] connected to mongo",
      );
      return c;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.error(
        { err: lastError.message },
        "[db] mongo connection failed",
      );
      // Clean up — let the next call retry from scratch.
      await c.close().catch(() => {});
      throw lastError;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

export async function getDb(): Promise<Db> {
  const c = await connect();
  return c.db(env.MONGO_DB_NAME);
}

/** Tear down — used by graceful shutdown only. */
export async function disconnect(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

/**
 * Snapshot of current DB state for /readyz. Does NOT trigger a connect
 * attempt; if the service hasn't tried yet, reports `unknown`.
 */
export function dbStatus(): {
  state: "connected" | "connecting" | "disconnected" | "unknown";
  error: string | null;
} {
  if (client) return { state: "connected", error: null };
  if (connecting) return { state: "connecting", error: null };
  if (lastError) return { state: "disconnected", error: lastError.message };
  return { state: "unknown", error: null };
}

/**
 * Best-effort live check used by /readyz. Returns true iff a ping
 * succeeded just now. Cheap (~1ms on local Mongo) so safe to call per
 * probe.
 */
export async function pingDb(): Promise<boolean> {
  try {
    const c = await connect();
    await c.db(env.MONGO_DB_NAME).command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

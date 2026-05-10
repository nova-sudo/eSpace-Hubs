/**
 * Typed collection getters and `ensureIndexes()` invoked at boot.
 *
 * This file is intentionally bare in M2.1. Each collection (`users`,
 * `sessions`, `audit_log`, `orgs`, …) lands in M2.2 with:
 *
 *   - a TS interface for the document shape
 *   - a `getXCollection(): Collection<X>` accessor
 *   - an entry in `ensureIndexes()` declaring required indexes
 *   - an entry in `applyValidators()` declaring the $jsonSchema
 *     validator so Mongo rejects malformed writes as a backstop
 *
 * Keeping the wiring centralised here means the boot sequence has one
 * place to call (`ensureIndexes()`) and we never accidentally diverge
 * between "what TypeScript thinks the collection looks like" and "what
 * Mongo actually validates".
 */

import { logger } from "../lib/logger.js";

/**
 * Idempotent — safe to call on every boot. Mongo treats `createIndex`
 * with the same key + options as a no-op.
 *
 * Real index declarations land in M2.2.
 */
export async function ensureIndexes(): Promise<void> {
  // No collections yet — nothing to do.
  logger.debug("[db] ensureIndexes: no collections registered yet (M2.1)");
}

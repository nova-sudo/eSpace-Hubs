/**
 * `buildPacketPayload` bound to the real goal-tiers stores.
 *
 * Kept apart from the pure builder because the goal-tiers barrel does not
 * load under node:test (it pulls its React UI), so the builder's test
 * imports `./build-packet-payload.js` directly and injects stub readers.
 */

import { readManagerVerdict, readTierPolicy } from "@/features/goal-tiers";

import { buildPacketPayload as buildPure } from "./build-packet-payload";

/** Same contract as the pure builder; `readers` overrides either store. */
export function buildPacketPayload(input, readers = {}) {
  return buildPure(input, { readTierPolicy, readManagerVerdict, ...readers });
}

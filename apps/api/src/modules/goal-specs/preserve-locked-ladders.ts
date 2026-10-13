/**
 * Locked ladders survive stale saves.
 *
 * A manager can edit a goal's achievement ladders while approving it, which
 * stamps `tiersLocked: true`. A dev tab opened before that still holds the
 * old ladders and PUTs the whole spec on any unrelated save — without this
 * guard it would silently overwrite the manager's levels.
 *
 * When the STORED spec is locked and the request is not an explicit tier
 * edit (`?tiersEdit=1`, sent only by `updateSpecTiers`), the stored `tiers`,
 * `cadenceTiers` and `tiersLocked` replace whatever the request carried.
 * An explicit tier edit (including an unlock) and any save over an unlocked
 * spec pass through unchanged.
 */

const LADDER_KEYS = ["tiers", "cadenceTiers", "tiersLocked"] as const;

export function preserveLockedLadders(
  stored: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown>,
  { tiersEdit }: { tiersEdit: boolean },
): Record<string, unknown> {
  if (tiersEdit || !stored || stored.tiersLocked !== true) return incoming;
  const merged: Record<string, unknown> = { ...incoming };
  for (const key of LADDER_KEYS) {
    if (stored[key] === undefined) delete merged[key];
    else merged[key] = stored[key];
  }
  return merged;
}

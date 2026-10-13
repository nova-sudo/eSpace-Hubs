import type { SpecTiers } from "./types.js";

export interface LadderPolicy {
  finalTiers?: SpecTiers | null;
  cadenceTiers?: SpecTiers | null;
}

export interface ResolvedLadders {
  final: SpecTiers | null;
  cadence: SpecTiers | null;
  cadenceFallback: boolean;
  finalGoverned: boolean;
  cadenceGoverned: boolean;
}

export function resolveLadders(
  spec: { tiers?: SpecTiers | null; cadenceTiers?: SpecTiers | null } | null | undefined,
  policy: LadderPolicy | null | undefined,
): ResolvedLadders;

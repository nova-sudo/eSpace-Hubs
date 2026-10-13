/**
 * Two-ladder tiers: a goal has a whole-cycle ladder (`tiers` / policy
 * `finalTiers`) and a one-window ladder (`cadenceTiers`). A manager policy
 * ladder outranks the spec's, per ladder. With no cadence ladder anywhere,
 * cadence falls back to the whole-cycle one (`cadenceFallback`).
 *
 * @param {{ tiers?: object|null, cadenceTiers?: object|null }|null} spec
 * @param {{ finalTiers?: object|null, cadenceTiers?: object|null }|null} policy
 */
export function resolveLadders(spec, policy) {
  const policyFinal = policy?.finalTiers ?? null;
  const policyCadence = policy?.cadenceTiers ?? null;
  const specFinal = spec?.tiers ?? null;
  const specCadence = spec?.cadenceTiers ?? null;

  const final = policyFinal ?? specFinal;
  const ownCadence = policyCadence ?? specCadence;
  const cadenceFallback = ownCadence == null && final != null;
  return {
    final,
    cadence: ownCadence ?? final,
    cadenceFallback,
    finalGoverned: policyFinal != null,
    cadenceGoverned: policyCadence != null,
  };
}

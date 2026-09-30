/**
 * Server-side enforcement of the "re-grade a goal tier at most once a day"
 * rule. The client already throttles (use-goal-tier.js: criteria change →
 * grade now; data change → at most once per local day), but only against
 * its localStorage — a cleared cache, a second device, or a fresh sign-in
 * reset it and re-spent a model call per goal. The durable
 * goal_tier_verdicts row knows when the model last graded, so the server
 * applies the same rule.
 */

/** The calendar day (YYYY-MM-DD) `at` falls on in a zone `tzOffsetMinutes`
 *  behind UTC (JS `Date#getTimezoneOffset()` sign convention). */
export function localDayKey(at: Date, tzOffsetMinutes = 0): string {
  const offset = Number.isFinite(tzOffsetMinutes)
    ? Math.max(-14 * 60, Math.min(14 * 60, tzOffsetMinutes))
    : 0;
  return new Date(at.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export interface ThrottleInput {
  /** The stored verdict row for (user, goal, window), if any. */
  hit: { tierHash: string; gradedAt?: Date | string | null; provider?: string | null } | null;
  /** The hash the client wants graded. */
  tierHash: string | undefined;
  /** Explicit user action (re-grade button / fill) — never throttled. */
  force?: boolean;
  /** The client KNOWS the tier criteria changed since its last grade. */
  criteriaChanged?: boolean;
  now?: Date;
  tzOffsetMinutes?: number;
}

/**
 * True when a new model call must be refused and the stored verdict
 * returned instead: a same-hash request is a plain cache hit (handled
 * before this), so this is about a CHANGED hash inside the same day.
 *
 * Not throttled when: forced, the criteria changed, there is no stored
 * AI verdict (first grade — rows the client mirrored, `provider:
 * client-*`, are not AI grades), or the stored grade is from an earlier
 * local day.
 */
export function isRegradeThrottled(input: ThrottleInput): boolean {
  const { hit, tierHash, force, criteriaChanged } = input;
  if (force || criteriaChanged) return false;
  if (!hit || !tierHash || hit.tierHash === tierHash) return false;
  if (typeof hit.provider === "string" && hit.provider.startsWith("client-")) return false;
  const gradedAt = hit.gradedAt instanceof Date ? hit.gradedAt : hit.gradedAt ? new Date(hit.gradedAt) : null;
  if (!gradedAt || Number.isNaN(gradedAt.getTime())) return false;
  const now = input.now ?? new Date();
  const tz = input.tzOffsetMinutes ?? 0;
  return localDayKey(gradedAt, tz) === localDayKey(now, tz);
}

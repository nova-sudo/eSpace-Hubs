/**
 * Compose: settle a composed tracker's two tier ladders.
 *
 * `tiers` grades the WHOLE plan, `cadenceTiers` ONE window. A model answer
 * that mixes up their scopes gets one corrective round trip (`retry`); if the
 * ladders are still crossed, a bad per-window ladder is swapped for the
 * derived one and the notes are surfaced to the user.
 */

import { deriveCadenceTiers } from "./cadence-tiers.js";

type Ladder = Record<string, string>;

/**
 * Totals across the whole cycle — "all 13 weekly deliverables", "6 of 6
 * monthly checkpoints", "every one of the 12 months". Built per noun set: a
 * per-period ladder must cite none of them, but a whole-plan ladder may.
 */
export const cycleTotalPattern = (noun: string): RegExp =>
  new RegExp(
    // "all 13 weekly deliverables", "every one of the 12 months"
    `\\b(?:all|every|each)\\s+(?:one\\s+)?(?:of\\s+)?(?:the\\s+)?\\d{1,3}\\s+(?:\\w+\\s+)?${noun}\\b` +
      // "6 of 6 monthly checkpoints", "13/13 weeks" — the optional adjective
      // between the count and the noun is why this can't be one branch.
      `|\\b\\d{1,3}\\s*(?:/|of)\\s*\\d{1,3}\\s+(?:\\w+\\s+)?${noun}\\b`,
    "i",
  );
const CYCLE_NOUN =
  "(?:day|week|month|quarter|period|sprint|milestone|checkpoint|deliverable)s?";
/** Any whole-cycle total, time or item — wrong inside a per-period ladder. */
const WHOLE_CYCLE_TIER = cycleTotalPattern(CYCLE_NOUN);

/** "this week", "this quarter" — wording that only makes sense for ONE window. */
const SINGLE_WINDOW_TIER = /\bthis (week|month|quarter|period|window)\b/i;

/**
 * Flag a ladder written for the wrong scope.
 *
 * A composed tracker carries two ladders: `tiers` grades the WHOLE plan (and
 * may cite totals across periods), `cadenceTiers` grades ONE window on its own
 * (and must not). A per-window bar that says "all 24 weekly deliverables" can
 * never be met inside a week, and a whole-plan bar that says "this week" has no
 * week to look at — either way the grader is handed a question it can't
 * answer. Returns one note per offending ladder, empty when both are clean.
 */
export function findCrossScopeTiers(
  tiers: Record<string, string> | null,
  cadenceTiers: Record<string, string> | null,
): string[] {
  const offenders = (
    ladder: Record<string, string> | null,
    pattern: RegExp,
  ): string[] =>
    ladder
      ? Object.entries(ladder)
          .filter(([, text]) => pattern.test(text))
          .map(([tier]) => tier)
      : [];
  const notes: string[] = [];
  const cycleInWindow = offenders(cadenceTiers, WHOLE_CYCLE_TIER);
  if (cycleInWindow.length > 0) {
    notes.push(
      `Per-period bar (cadenceTiers: ${cycleInWindow.join(", ")}) cites a total across the whole plan — one period on its own can't meet it.`,
    );
  }
  const windowInCycle = offenders(tiers, SINGLE_WINDOW_TIER);
  if (windowInCycle.length > 0) {
    notes.push(
      `Whole-plan bar (tiers: ${windowInCycle.join(", ")}) is worded for a single period — the whole-cycle grade has no one period to read it against.`,
    );
  }
  return notes;
}

export type ScopedLadders = { tiers: Ladder | null; cadenceTiers: Ladder | null };

/**
 * Resolve a model's ladders to ones written for their own scope.
 *
 * Clean input returns at once (no retry). Otherwise `retry(notes)` gets one
 * chance to correct them — `null` (skipped, e.g. no budget) or a throw keeps
 * the first answer; a missing ladder in the retry keeps the first one too.
 * Still crossed afterwards: `cadenceTiers` becomes the derived per-period
 * ladder ONLY when it is the offender (a clean model one is kept), `tiers`
 * is always kept, and `notes` say what is still wrong.
 */
export async function settleScopedLadders({
  tiers,
  cadenceTiers,
  retry,
}: ScopedLadders & {
  retry: (notes: string[]) => Promise<ScopedLadders | null>;
}): Promise<ScopedLadders & { notes: string[] }> {
  let notes = findCrossScopeTiers(tiers, cadenceTiers);
  if (notes.length === 0) return { tiers, cadenceTiers, notes };
  try {
    const fixed = await retry(notes);
    if (fixed) {
      tiers = fixed.tiers ?? tiers;
      cadenceTiers = fixed.cadenceTiers ?? cadenceTiers;
      notes = findCrossScopeTiers(tiers, cadenceTiers);
    }
  } catch {
    // The caller logs; the first answer stands.
  }
  if (notes.length > 0 && findCrossScopeTiers(null, cadenceTiers).length > 0) {
    cadenceTiers = deriveCadenceTiers("COMPOSED", tiers);
  }
  return { tiers, cadenceTiers, notes };
}

/**
 * Pure status taxonomy for the Goal Intelligence Hub.
 *
 * Maps a (spec, entries) pair to one health status — the rule-based
 * Sprint-1 signal. No React, no IO, no AI. Sprint 2 layers the AI tier
 * verdict (Ahead / Role-model) ON TOP of this by reading `health.status`
 * for the baseline and overriding with the grader's verdict when present;
 * nothing here needs to change for that.
 *
 * Why rule-based first: every signal below is derivable from data the
 * app already holds (goal-inputs entries + the classified spec). It ships
 * without a model call, and it's the honest floor the AI narrative builds
 * its prose from.
 *
 * Status meanings
 * ───────────────
 *   UNCLASSIFIED  goal has no spec yet — can't be tracked until the
 *                 analyst classifies it. (Grid buckets these separately.)
 *   AUTO          spec.widget is an AUTO-variant (incl. CODE_RUBRIC,
 *                 SCORECARD): the value is computed from integration data,
 *                 nothing to "fill". We surface it as tracked, no CTA.
 *   NO_DATA       manual goal, zero entries ever — needs a first fill.
 *   STALE         manual goal with history but nothing in the current
 *                 cadence window — the user has gone dark. Needs filling.
 *   BEHIND        manual goal filled this window but below target — on the
 *                 board, just not hitting the number.
 *   ON_PACE       manual goal filled this window and meeting target (or no
 *                 target defined, in which case presence === on pace).
 */

import { SPEC_KIND_META, SPEC_VARIANTS } from "@/features/goal-specs";
import { computeCompliance, fillStats } from "@/features/goal-inputs";

export const HEALTH = Object.freeze({
  UNCLASSIFIED: "unclassified",
  AUTO: "auto",
  NO_DATA: "no_data",
  STALE: "stale",
  BEHIND: "behind",
  ON_PACE: "on_pace",
});

/**
 * Statuses that should pull the goal into the "needs attention" focus
 * view and the Action Queue. AUTO + ON_PACE are healthy/hands-off.
 */
export const NEEDS_ATTENTION = Object.freeze(
  new Set([HEALTH.NO_DATA, HEALTH.STALE, HEALTH.BEHIND]),
);

// Cadences that don't bucket into recurring windows — a milestone is
// one-time, continuous is always-on, per-incident is event-driven. For
// these, "filled this week" is meaningless: presence of any data = tracked.
const NON_BUCKETING = Object.freeze(
  new Set(["milestone", "continuous", "per-incident"]),
);

/**
 * Derive the rule-based health of one classified goal.
 *
 * @param {{ spec: object | null, entries: Array<{ts:number,value:any}> }} input
 * @returns {{
 *   status: string,
 *   needsFill: boolean,
 *   fill: object | null,        // fillStats() output (null for AUTO/unclassified)
 *   compliance: object | null,  // computeCompliance() output when a target exists
 * }}
 */
export function deriveGoalHealth({ spec, entries }) {
  if (!spec) {
    return { status: HEALTH.UNCLASSIFIED, needsFill: false, fill: null, compliance: null };
  }

  const variant = SPEC_KIND_META[spec.widget]?.variant ?? null;
  // AUTO variant covers MERGED_COUNT/LINKAGE/… plus CODE_RUBRIC and
  // SCORECARD (both declared AUTO in SPEC_KIND_META). All are computed,
  // not hand-filled, so there's no "fill now" obligation in Sprint 1.
  if (variant === SPEC_VARIANTS.AUTO) {
    return { status: HEALTH.AUTO, needsFill: false, fill: null, compliance: null };
  }

  const cadence = spec.manual?.cadence ?? null;
  const target = spec.manual?.target ?? null;
  const fill = fillStats(entries, cadence);

  if (!fill.hasData) {
    return { status: HEALTH.NO_DATA, needsFill: true, fill, compliance: null };
  }

  // One-time / event-driven goals: any data means it's being tracked.
  // We don't nag for a "current window" fill that doesn't exist.
  if (NON_BUCKETING.has(cadence)) {
    return { status: HEALTH.ON_PACE, needsFill: false, fill, compliance: null };
  }

  if (!fill.filledCurrentWindow) {
    return { status: HEALTH.STALE, needsFill: true, fill, compliance: null };
  }

  // Filled this window — is it hitting the number? Only when a target is
  // declared and the cadence buckets (computeCompliance returns null
  // otherwise, which we read as "presence is enough").
  const compliance = target ? computeCompliance(entries, target, cadence) : null;
  if (compliance && compliance.latestWindowMet === false) {
    return { status: HEALTH.BEHIND, needsFill: false, fill, compliance };
  }

  return { status: HEALTH.ON_PACE, needsFill: false, fill, compliance };
}

/**
 * Display metadata per status — label + tone token for chips. `tone` maps
 * to the Pill component's vocabulary (default/accent/solid/warn/ok/muted).
 * `dot` is a hex for the leading status dot, letting the three "attention"
 * states read distinctly even though they share the warn pill tone.
 */
export const STATUS_META = Object.freeze({
  [HEALTH.UNCLASSIFIED]: { label: "Not classified", tone: "muted", dot: "#9ca3af" },
  [HEALTH.AUTO]: { label: "Auto-tracked", tone: "accent", dot: "var(--accent)" },
  [HEALTH.NO_DATA]: { label: "No data", tone: "warn", dot: "#dc2626" },
  [HEALTH.STALE]: { label: "Needs update", tone: "warn", dot: "#ea580c" },
  [HEALTH.BEHIND]: { label: "Behind target", tone: "warn", dot: "#d97706" },
  [HEALTH.ON_PACE]: { label: "On pace", tone: "ok", dot: "var(--good)" },
});

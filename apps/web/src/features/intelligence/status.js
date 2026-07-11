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

import {
  SPEC_KINDS,
  SPEC_KIND_META,
  SPEC_VARIANTS,
  specCadence,
} from "@/features/goal-specs";
import { computeCompliance, buildCycleWindows } from "@/features/goal-inputs";
import { goalReadiness, GOAL_READINESS } from "@/features/goal-widgets";

export const HEALTH = Object.freeze({
  UNCLASSIFIED: "unclassified",
  NEEDS_SETUP: "needs_setup", // classified but not ready: context unanswered,
  //                             untrackable, or delegated — can't be filled yet
  AUTO: "auto",
  NO_DATA: "no_data",
  STALE: "stale",
  BEHIND: "behind",
  ON_PACE: "on_pace",
  LOCKED: "locked", // user finalised this window — settled, not owed
});

/**
 * Statuses that mean "you owe this goal a DATA entry" — the only thing that
 * belongs in "Do next" / the focus view. BEHIND is deliberately NOT here:
 * a behind-target goal is already filled, so it's a performance SIGNAL (a
 * card chip), not a chore. AUTO + ON_PACE are healthy/hands-off.
 */
export const NEEDS_ATTENTION = Object.freeze(
  new Set([HEALTH.NO_DATA, HEALTH.STALE]),
);

// Target-attainment ("behind") is only meaningful for widgets whose entry
// value is a NUMBER. Checklist / composite / incident / before-after store
// objects — feeding those to computeCompliance coerces them to NaN and
// falsely reads "behind" (a 100%-complete milestone is NOT behind). For
// those kinds the AI tier verdict carries achievement; the rule-based
// status just says "on pace" once it's filled.
const NUMERIC_MANUAL_KINDS = Object.freeze(
  new Set([SPEC_KINDS.COUNTER, SPEC_KINDS.SCALE, SPEC_KINDS.DATE_LOG]),
);

/**
 * Derive the rule-based health of one classified goal.
 *
 * @param {{ spec: object | null, entries: Array<{ts:number,value:any}> }} input
 * @returns {{
 *   status: string,
 *   needsFill: boolean,
 *   fill: object | null,        // { hasData, filledCurrentWindow, windows, total,
 *                                //   filledCount, currentIndex, lastEntryTs }.
 *                                // Non-pip cadences: cycle-anchored (buildCycleWindows),
 *                                // windows/total/filledCount/currentIndex are real.
 *                                // Non-bucketing cadences (milestone/continuous/
 *                                // per-incident) with data: a DEGENERATE non-null
 *                                // shape — windows:[], total:0, currentIndex:-1 —
 *                                // carrying only lastEntryTs for the footer; check
 *                                // `total` before treating `windows` as real (see
 *                                // FillStrip's `!fill.total` guard). null for
 *                                // AUTO/unclassified/no-data.
 *   compliance: object | null,  // computeCompliance() output when a target exists
 * }}
 */
export function deriveGoalHealth({
  spec,
  entries,
  lockedCurrentWindow = false,
  contextComplete = false,
}) {
  if (!spec) {
    return { status: HEALTH.UNCLASSIFIED, needsFill: false, fill: null, compliance: null };
  }

  // Readiness gate — the SAME gate the hub widget and check-in obey. A goal
  // that still needs setup (context unanswered) or is untrackable/delegated
  // can't be filled or graded, so it must not read as NO_DATA ("you owe a
  // fill") — that's the bug where check-in offered a fillable milestone for a
  // goal whose context questions weren't answered. It gets its own status and
  // is excluded from the fill/attention math.
  const readiness = goalReadiness(spec, contextComplete);
  if (readiness !== GOAL_READINESS.READY) {
    return {
      status: HEALTH.NEEDS_SETUP,
      readiness,
      needsFill: false,
      fill: null,
      compliance: null,
    };
  }

  const variant = SPEC_KIND_META[spec.widget]?.variant ?? null;
  // AUTO variant covers MERGED_COUNT/LINKAGE/… plus CODE_RUBRIC and
  // SCORECARD (both declared AUTO in SPEC_KIND_META). All are computed,
  // not hand-filled, so there's no "fill now" obligation in Sprint 1.
  if (variant === SPEC_VARIANTS.AUTO) {
    return { status: HEALTH.AUTO, needsFill: false, fill: null, compliance: null };
  }

  // COMPOSED keeps its cadence at `composed.cadence` — specCadence resolves
  // both homes, so a monthly composed goal buckets on months, not the
  // weekly fallback (which mislabeled it stale/overdue after 2+ weeks).
  const cadence = specCadence(spec);
  const target = spec.manual?.target ?? null;
  const list = Array.isArray(entries) ? entries : [];
  const hasData = list.length > 0;
  const lastEntryTs = hasData ? list[list.length - 1].ts : null;

  if (!hasData) {
    // User finalised this window ("nothing to report") → settled, not owed.
    if (lockedCurrentWindow) {
      return { status: HEALTH.LOCKED, needsFill: false, fill: null, compliance: null };
    }
    return { status: HEALTH.NO_DATA, needsFill: true, fill: null, compliance: null };
  }

  // Cycle-anchored windows — the SAME model the Goals-page cadence stepper
  // uses (buildCycleWindows), so the two surfaces never disagree about which
  // periods are filled/owed. Previously this read a SEPARATE rolling-last-4
  // model (fillStats) that showed a fixed "X/4" regardless of cadence — a
  // meaningless denominator for anything but quarterly (4 quarters = a year)
  // and one that dropped real history older than 4 periods from the count.
  // "pip" mode covers non-bucketing cadences (milestone/continuous/
  // per-incident) and a missing/malformed cadence — any data at all means
  // tracked, same as before. There's no real "window" concept for those, but
  // the footer's "last logged" line still needs lastEntryTs, so `fill` stays
  // a minimal object rather than null (FillStrip no-ops on total:0).
  const cycle = buildCycleWindows({ entries: list, cadence, now: Date.now() });
  if (cycle.mode === "pip") {
    return {
      status: HEALTH.ON_PACE,
      needsFill: false,
      fill: {
        hasData: true,
        filledCurrentWindow: true,
        windows: [],
        total: 0,
        filledCount: 0,
        currentIndex: -1,
        lastEntryTs,
      },
      compliance: null,
    };
  }

  const currentWindow = cycle.currentIndex >= 0 ? cycle.windows[cycle.currentIndex] : null;
  const filledCurrentWindow = currentWindow?.filled === true;
  const fill = {
    hasData: true,
    filledCurrentWindow,
    windows: cycle.windows, // oldest→newest window objects, unlike the old boolean[]
    total: cycle.total,
    filledCount: cycle.filledCount,
    currentIndex: cycle.currentIndex,
    lastEntryTs,
  };

  if (!filledCurrentWindow) {
    // A lock settles the current window even when it's empty.
    if (lockedCurrentWindow) {
      return { status: HEALTH.LOCKED, needsFill: false, fill, compliance: null };
    }
    // How many consecutive windows, walking back from the current one, are
    // empty? Two or more = the user has skipped a whole period, not just
    // "haven't gotten to this week yet" → escalate to overdue. Bounded by
    // the cycle year: a goal that's truly been stale since December briefly
    // under-counts in the first period of January (there's nothing before
    // it to walk back through yet) — self-corrects within a period or two
    // as the new cycle accumulates owed windows.
    const missedWindows = leadingEmptyFromCycle(cycle.windows, cycle.currentIndex);
    return {
      status: HEALTH.STALE,
      needsFill: true,
      overdue: missedWindows >= 2,
      missedWindows,
      fill,
      compliance: null,
    };
  }

  // Filled this window — is it hitting the number? Only for NUMERIC widgets
  // with a target; object-valued widgets (checklist/composite/incident) are
  // never read as "behind" here (the AI tier judges those instead).
  const compliance =
    target && NUMERIC_MANUAL_KINDS.has(spec.widget)
      ? computeCompliance(entries, target, cadence)
      : null;
  if (compliance && compliance.latestWindowMet === false) {
    return { status: HEALTH.BEHIND, needsFill: false, fill, compliance };
  }

  return { status: HEALTH.ON_PACE, needsFill: false, fill, compliance };
}

/**
 * Count consecutive empty windows walking BACKWARD from the current one
 * (inclusive), stopping at the first filled window (or cycle start) — how
 * long the goal's been gone dark, without over-counting past a real fill.
 */
function leadingEmptyFromCycle(windows, currentIndex) {
  if (!Array.isArray(windows) || currentIndex < 0) return 0;
  const current = windows[currentIndex];
  if (!current || current.filled) return 0;
  let n = 1;
  for (let i = currentIndex - 1; i >= 0; i -= 1) {
    if (windows[i]?.state === "owed") n += 1;
    else break;
  }
  return n;
}

/**
 * Direction-of-travel for one goal, from its recent snapshot readings.
 *
 * Snapshots are newest-first; each carries `goalReadings[goalId]`. We take
 * the two most recent comparable scalars (per-period `weekContribution`
 * preferred over lifetime `cumulative`) and compare them. Crucially,
 * "up" isn't always good — for a `<=` target (e.g. turnaround time, lower
 * is better) a rising value is bad — so we resolve GOODNESS against the
 * spec's target op, not the raw direction.
 *
 * @returns {{ dir: "up"|"down"|"flat", good: boolean|null } | null}
 *          null when there aren't two comparable readings yet.
 */
export function computeTrend(snapshots, goalId, spec) {
  if (!Array.isArray(snapshots) || !goalId) return null;

  const series = [];
  for (const s of snapshots) {
    const r = s?.goalReadings?.[goalId];
    if (!r) continue;
    const raw = r.weekContribution ?? r.cumulative ?? null;
    const v = raw == null ? null : Number(raw);
    if (v == null || !Number.isFinite(v)) continue;
    series.push(v);
    if (series.length >= 2) break; // newest two is enough for a direction
  }
  if (series.length < 2) return null;

  const [latest, prev] = series;
  let dir = "flat";
  if (latest > prev) dir = "up";
  else if (latest < prev) dir = "down";

  const op = (spec?.manual?.target || spec?.source?.target)?.op || null;
  let good = null;
  if (dir !== "flat" && op) {
    if (op === ">=") good = dir === "up";
    else if (op === "<=") good = dir === "down";
  }
  return { dir, good };
}

/**
 * Display metadata per status — label + tone token for chips. `tone` maps
 * to the Pill component's vocabulary (default/accent/solid/warn/ok/muted).
 * `dot` is a hex for the leading status dot, letting the three "attention"
 * states read distinctly even though they share the warn pill tone.
 */
export const STATUS_META = Object.freeze({
  [HEALTH.UNCLASSIFIED]: { label: "Not classified", tone: "muted", dot: "#9ca3af" },
  [HEALTH.NEEDS_SETUP]: { label: "Needs setup", tone: "muted", dot: "#a855f7" },
  [HEALTH.AUTO]: { label: "Auto-tracked", tone: "accent", dot: "var(--accent)" },
  [HEALTH.NO_DATA]: { label: "No data", tone: "warn", dot: "#dc2626" },
  [HEALTH.STALE]: { label: "Needs update", tone: "warn", dot: "#ea580c" },
  [HEALTH.BEHIND]: { label: "Behind target", tone: "warn", dot: "#d97706" },
  [HEALTH.ON_PACE]: { label: "On pace", tone: "ok", dot: "var(--good)" },
  [HEALTH.LOCKED]: { label: "Finalized", tone: "muted", dot: "#9ca3af" },
});

/**
 * The chip to show for a card's health — STATUS_META, but escalated to a
 * harder "Overdue" when a stale goal has gone dark for 2+ windows. One
 * place so cards and the Action Queue stay in sync.
 */
export function statusDisplay(health) {
  if (health?.overdue) {
    return { label: "Overdue", tone: "warn", dot: "#b91c1c" };
  }
  return STATUS_META[health?.status] ?? STATUS_META[HEALTH.NO_DATA];
}

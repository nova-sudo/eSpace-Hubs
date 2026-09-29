/**
 * One vocabulary for cadence windows — the words every surface uses to name
 * a window's state and its period. These used to be copied into the stepper,
 * the flow strip, the fill strip, the counter widget and the editors, and
 * the copies had started to drift ("two weeks" vs "fortnight").
 */

import { cadenceWindowLabel } from "./compliance";

/**
 * A window's state in words. "missed" for a window that ended without an
 * entry — distinct from the goal STATUS "Not logged", which means nothing
 * has ever been logged on the goal.
 */
export const WINDOW_STATE_LABEL = Object.freeze({
  filled: "logged",
  owed: "missed",
  current: "current",
  future: "upcoming",
  settled: "nothing to report",
  before: "before this tracker",
});

/** Tooltip / legend copy for a window that predates the tracker. */
export const BEFORE_TRACKER_HINT = "Before this tracker existed — you can still backfill it.";

/** Tooltip for one window cell: "W39 · missed · now", or the before-tracker hint. */
export function windowCellTitle(w, state = w?.state, isCurrent = false) {
  const label = w?.label ?? "";
  if (state === "before") return `${label} · ${BEFORE_TRACKER_HINT}`;
  return `${label} · ${WINDOW_STATE_LABEL[state] || state}${isCurrent ? " · now" : ""}`;
}

/** "week" / "month" / "quarter" … — "window" for a cadence with no period. */
export function cadencePeriodWord(cadence) {
  return cadenceWindowLabel(cadence)[0];
}

/** "this week" / "this month" / "this window" — never "week" for a quarterly goal. */
export function thisPeriod(periodWord) {
  return `this ${periodWord || "window"}`;
}

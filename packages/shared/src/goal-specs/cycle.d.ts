/**
 * Type signatures for cycle.js — plan length ↔ inclusive end day.
 */

/** Hard ceiling on windows in one cycle — mirrors COMPOSED_MAX_PERIODS. */
export const CYCLE_MAX_WINDOWS: number;

/** Inclusive last day of the `count`-th window from `cycleStartIso`, or null. */
export function cycleEndForCount(
  cycleStartIso: string,
  cadence: string,
  count: number,
): string | null;

/** How many windows tile the inclusive [start, end] day pair, or null. */
export function windowCountForCycle(
  cycleStartIso: string,
  cadence: string,
  cycleEndIso: string,
): number | null;

/** First day of the cadence period containing `nowMs`. */
export function snapCycleStart(cadence: string, nowMs: number): string;

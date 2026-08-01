/**
 * Per-goal cadence + headline-value reads, computed OUTSIDE React hook rules
 * — needed because the row LIST (owed-only filtering, L1 progress
 * aggregation, the collapsed row's mini stepper) all need this before/
 * alongside any row component mounts, not just from inside one row's own
 * hooks. Mirrors the synchronous-read pattern `readCappedGoalTier` already
 * uses for the same reason (ranking/filtering many goals outside a
 * component tree).
 *
 * The caller is responsible for re-running these after the stores they
 * actually subscribe to (`useAllGoalInputs`, `useGoalLocks`) tick.
 */

import {
  readGoalEntries,
  buildCycleWindows,
  composedCycleBounds,
} from "@/features/goal-inputs";
import { readLocks } from "@/features/goal-locks";
import { isSingleRecordWidget, specCadence } from "@/features/goal-specs";
import { readCappedGoalTier, readGoalTier, numericReadingFor } from "@/features/goal-tiers";

/** This goal's cadence windows (`buildCycleWindows`' full result), or null
 *  for a single-record / non-cadenced goal. */
export function cadenceWindowsFor(goalId, spec) {
  if (!goalId || !spec) return null;
  const cadence = isSingleRecordWidget(spec.widget) ? null : specCadence(spec);
  if (!cadence) return null;

  const entries = readGoalEntries(goalId);
  const prefix = `${goalId}::`;
  const allLocks = readLocks();
  const lockedKeys = new Set();
  for (const k of Object.keys(allLocks)) {
    if (allLocks[k] && k.startsWith(prefix)) lockedKeys.add(k.slice(prefix.length));
  }

  const cyc = buildCycleWindows({
    entries,
    cadence,
    now: Date.now(),
    lockedKeys,
    ...composedCycleBounds(spec),
  });
  return cyc.mode === "pip" ? null : cyc;
}

/** True when this goal has at least one "owed" (not logged, not settled)
 *  cadence window right now. */
export function isGoalOwed(goalId, spec) {
  const cyc = cadenceWindowsFor(goalId, spec);
  if (!cyc) return false;
  return (cyc.windows || []).some((w) => w.state === "owed");
}

/** The tier color this ONE window was graded, or null if ungraded. Reads
 *  the same per-window verdict cache `useGoalWindowTier` reads, just
 *  outside a hook. */
export function windowTier(goalId, periodKey) {
  const stored = readGoalTier(goalId, periodKey);
  return stored?.tier || null;
}

const TIER_COLOR = {
  not_achieved: "#b91c1c",
  achieved: "#1D4ED8",
  over_achieved: "#00c48a",
  role_model: "#f59e0b",
};

export function tierColor(tier) {
  return tier ? TIER_COLOR[tier] || null : null;
}

/** Compact "value + status" for the collapsed row's right column. Numeric-
 *  ladder kinds (COUNTER/SCALE/DATE_LOG/AUTO) get their real number;
 *  everything else (MILESTONE, COMPOSED, SCORECARD, ...) falls back to an
 *  entry count — full per-kind headline formatting lives inside each
 *  widget file and isn't centralized here (see STATUS.md). */
export function goalHeadline(goalId, spec) {
  if (!goalId || !spec) return { value: "—", status: "", statusColor: "var(--muted-fg)" };
  const entries = readGoalEntries(goalId);
  const reading = numericReadingFor(spec, entries, null);
  const capped = readCappedGoalTier(goalId, spec, entries, null, null);

  const value = reading
    ? `${formatNumber(reading.value)}${reading.unit ? ` ${reading.unit}` : ""}`
    : entries.length > 0
      ? String(entries.length)
      : "—";

  let status = "";
  let statusColor = "var(--muted-fg)";
  if (capped?.tier) {
    if (capped.tier === "not_achieved") {
      status = "below target";
      statusColor = "var(--warn)";
    } else {
      status = "on target";
      statusColor = "var(--accent-2)";
    }
  }
  return { value, status, statusColor };
}

function formatNumber(n) {
  if (!Number.isFinite(n)) return String(n);
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

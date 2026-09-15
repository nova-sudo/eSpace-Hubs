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
import { isSingleRecordWidget, specCadence, SPEC_KIND_META } from "@/features/goal-specs";
import { readGoalTier, TIER_COLOR } from "@/features/goal-tiers";

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

/** The ink token for a tier, or null when ungraded. Delegates to the
 *  canonical tier -> token map in goal-tiers so this page can never drift
 *  from the tier badge's own colors. */
export function tierColor(tier) {
  return (tier && TIER_COLOR[tier]?.ink) || null;
}

/** The tracker kind as a human label — "Recurring milestone", "Counter". */
export function humanizeKind(widget) {
  const meta = SPEC_KIND_META?.[widget]?.label;
  if (meta) return meta;
  return String(widget || "")
    .toLowerCase()
    .replace(/_/g, " ");
}

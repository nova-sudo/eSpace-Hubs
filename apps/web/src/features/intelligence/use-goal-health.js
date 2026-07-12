"use client";

/**
 * The Goal Intelligence Hub's data hook — turns the classified goal tree
 * into a health model the page renders directly.
 *
 * One hook, three outputs:
 *   - groups   : L1-bucketed cards, each { goal, spec, health }
 *   - queue    : the needs-attention subset, severity-sorted (the Action
 *                Queue strip reads this verbatim)
 *   - summary  : headline counts for the page's status line
 *
 * Why derive everything here (not in the components): the per-goal entry
 * lookup has to happen outside React's hook rules — we can't call
 * useGoalInputs() in a map over N goals. So we mount the whole-map
 * hydrator once (useAllGoalInputs) and read each goal's entries through
 * readGoalEntries() inside a tick-keyed memo. Components stay pure render.
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  getInputsState,
  readGoalEntries,
  useAllGoalInputs,
} from "@/features/goal-inputs";
import { useSnapshots } from "@/features/snapshots";
import {
  isCurrentWindowLocked,
  currentWindowKey,
  readLocks,
  useGoalLocks,
} from "@/features/goal-locks";
import { isContextComplete, useAllGoalContext } from "@/features/goal-context";
import { specCadence } from "@/features/goal-specs";
import { GOAL_READINESS } from "@/features/goal-widgets";
import {
  readCappedGoalTier,
  hydrateGoalTiers,
  subscribeGoalTiers,
  getGoalTiersSnapshot,
  getGoalTiersServerSnapshot,
  TIER_ORDER,
} from "@/features/goal-tiers";
import {
  computeTrend,
  deriveGoalHealth,
  HEALTH,
} from "./status";

/**
 * Carousel ranking: WORST achievement tier first. A graded goal ranks by its
 * tier index (not_achieved = 0, the worst); a goal that still needs work but
 * isn't graded yet (no data / needs-setup) ranks AFTER the graded-failing ones.
 */
function carouselRank(card) {
  const t = card.tier;
  if (t == null) return TIER_ORDER.length; // ungraded → after not_achieved
  const i = TIER_ORDER.indexOf(t);
  return i < 0 ? TIER_ORDER.length : i;
}

/** The locked ("nothing to report") window keys for one goal, from the map. */
function lockedKeysFor(allLocks, goalId) {
  const set = new Set();
  const prefix = `${goalId}::`;
  for (const k of Object.keys(allLocks)) {
    if (allLocks[k] && k.startsWith(prefix)) set.add(k.slice(prefix.length));
  }
  return set;
}

/** Newest snapshot reading for a goal (snapshots are newest-first) — the numeric
 *  source for AUTO goals when grading a tier inline. */
function latestSnapReading(snapshots, goalId) {
  if (!Array.isArray(snapshots)) return null;
  for (const s of snapshots) {
    const r = s?.goalReadings?.[goalId];
    if (r) return r;
  }
  return null;
}

/**
 * @param {Array<{ l1: object, items: Array<{goal,spec}> }>} groupedItems
 *        Output of useGoalWidgetItems().groupedItems.
 */
export function useGoalHealth(groupedItems) {
  // Subscribe to the inputs store (returns a tick) AND guarantee the
  // one-shot hydration fires even if no per-goal hook is mounted.
  const inputsTick = useAllGoalInputs();
  // Snapshots drive the per-goal trend arrow. useSnapshots subscribes +
  // hydrates; `snapshots` is newest-first.
  const { snapshots } = useSnapshots();
  // Window locks settle "owed" status. Subscribe so a lock/unlock re-derives.
  const locksTick = useGoalLocks();
  // Context completeness drives the readiness gate. Subscribe + hydrate so a
  // card flips out of "Needs setup" the instant its questions are answered.
  const contextTick = useAllGoalContext();
  // The carousel now ranks by achievement tier, so re-derive when a verdict
  // lands (or the consistency cap shifts one).
  const tiersTick = useSyncExternalStore(
    subscribeGoalTiers,
    getGoalTiersSnapshot,
    getGoalTiersServerSnapshot,
  );
  // The Intelligence page can be the first thing loaded (home "/"), with the
  // full board collapsed — so no tier badge mounts to seed the verdict cache.
  // Hydrate it here so the carousel has real tiers on first paint.
  useEffect(() => {
    hydrateGoalTiers();
  }, []);

  return useMemo(() => {
    const groups = [];
    const queue = [];
    const allLocks = readLocks();
    const summary = {
      total: 0,
      onPace: 0,
      auto: 0,
      attention: 0,
      noData: 0,
      stale: 0,
      behind: 0,
      setup: 0,
      improving: 0,
      slipping: 0,
    };

    for (const group of groupedItems || []) {
      const cards = [];
      for (const { goal, spec } of group.items) {
        const entries = readGoalEntries(goal.id);
        const lockedCurrentWindow = isCurrentWindowLocked(
          goal.id,
          currentWindowKey(specCadence(spec)),
        );
        const health = deriveGoalHealth({
          spec,
          entries,
          lockedCurrentWindow,
          contextComplete: isContextComplete(spec),
        });
        const trend = computeTrend(snapshots, goal.id, spec);
        // The DISPLAYED achievement tier (with the consistency cap), read
        // synchronously — the carousel filters + ranks on it. Force null for
        // needs-setup / no-data goals: the badge shows "pending setup" /
        // "awaiting" for those (a stale cached verdict must NOT leak through and
        // wrongly include an untrackable/delegated goal — matches useGoalTier).
        const gradeable =
          health.status !== HEALTH.NEEDS_SETUP &&
          health.status !== HEALTH.NO_DATA;
        const tier = gradeable
          ? readCappedGoalTier(
              goal.id,
              spec,
              entries,
              lockedKeysFor(allLocks, goal.id),
              latestSnapReading(snapshots, goal.id),
            )
          : null;
        // Carry the L1 parent + tier so the Focus hero + carousel can show
        // "<kind> · <L1>" and rank without re-deriving downstream.
        const card = { goal, spec, health, trend, l1: group.l1, tier };
        cards.push(card);

        summary.total += 1;
        if (health.status === HEALTH.AUTO) summary.auto += 1;
        if (health.status === HEALTH.ON_PACE) summary.onPace += 1;
        if (health.status === HEALTH.NO_DATA) summary.noData += 1;
        if (health.status === HEALTH.STALE) summary.stale += 1;
        if (health.status === HEALTH.BEHIND) summary.behind += 1;
        if (health.status === HEALTH.NEEDS_SETUP) summary.setup += 1;
        if (trend?.good === true) summary.improving += 1;
        if (trend?.good === false) summary.slipping += 1;

        // Carousel = goals that haven't reached "Achieved": graded not_achieved,
        // plus goals with no data / actionable needs-setup that can't be graded
        // yet (setup questions unanswered). Goals at Achieved+ — and untrackable
        // / delegated goals, which are intentionally not self-tracked — stay out.
        const actionableSetup =
          health.status === HEALTH.NEEDS_SETUP &&
          health.readiness === GOAL_READINESS.NEEDS_CONTEXT;
        const ungradedNeedsWork =
          tier == null &&
          (health.status === HEALTH.NO_DATA || actionableSetup);
        if (tier === "not_achieved" || ungradedNeedsWork) {
          summary.attention += 1;
          queue.push(card);
        }
      }
      if (cards.length > 0) groups.push({ l1: group.l1, cards });
    }

    queue.sort((a, b) => {
      // Worst tier first.
      const r = carouselRank(a) - carouselRank(b);
      if (r !== 0) return r;
      // Tie-break: heavier (more important) L1 first, then longer-dark.
      const wa = Number(a.l1?.weightage) || 0;
      const wb = Number(b.l1?.weightage) || 0;
      if (wb !== wa) return wb - wa;
      return (b.health.missedWindows ?? 0) - (a.health.missedWindows ?? 0);
    });

    return {
      ready: getInputsState().fetched,
      groups,
      queue,
      summary,
    };
    // readGoalEntries / getInputsState read live store state; inputsTick
    // changes whenever that state mutates, so it's the correct memo key.
    // snapshots identity changes when the snapshot store updates; locksTick
    // bumps when a window is locked/unlocked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedItems, inputsTick, snapshots, locksTick, contextTick, tiersTick]);
}

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

import { useMemo } from "react";
import {
  getInputsState,
  readGoalEntries,
  useAllGoalInputs,
} from "@/features/goal-inputs";
import { useSnapshots } from "@/features/snapshots";
import {
  computeTrend,
  deriveGoalHealth,
  HEALTH,
  NEEDS_ATTENTION,
} from "./status";

// Action-Queue ordering: an untouched goal is more urgent than a stale
// one, which is more urgent than one that's filled-but-behind.
const SEVERITY = Object.freeze({
  [HEALTH.NO_DATA]: 0,
  [HEALTH.STALE]: 1,
  [HEALTH.BEHIND]: 2,
});

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

  return useMemo(() => {
    const groups = [];
    const queue = [];
    const summary = {
      total: 0,
      onPace: 0,
      auto: 0,
      attention: 0,
      noData: 0,
      stale: 0,
      behind: 0,
      improving: 0,
      slipping: 0,
    };

    for (const group of groupedItems || []) {
      const cards = [];
      for (const { goal, spec } of group.items) {
        const entries = readGoalEntries(goal.id);
        const health = deriveGoalHealth({ spec, entries });
        const trend = computeTrend(snapshots, goal.id, spec);
        const card = { goal, spec, health, trend };
        cards.push(card);

        summary.total += 1;
        if (health.status === HEALTH.AUTO) summary.auto += 1;
        if (health.status === HEALTH.ON_PACE) summary.onPace += 1;
        if (health.status === HEALTH.NO_DATA) summary.noData += 1;
        if (health.status === HEALTH.STALE) summary.stale += 1;
        if (health.status === HEALTH.BEHIND) summary.behind += 1;
        if (trend?.good === true) summary.improving += 1;
        if (trend?.good === false) summary.slipping += 1;
        if (NEEDS_ATTENTION.has(health.status)) {
          summary.attention += 1;
          queue.push(card);
        }
      }
      if (cards.length > 0) groups.push({ l1: group.l1, cards });
    }

    queue.sort(
      (a, b) =>
        (SEVERITY[a.health.status] ?? 9) - (SEVERITY[b.health.status] ?? 9),
    );

    return {
      ready: getInputsState().fetched,
      groups,
      queue,
      summary,
    };
    // readGoalEntries / getInputsState read live store state; inputsTick
    // changes whenever that state mutates, so it's the correct memo key.
    // snapshots identity changes when the snapshot store updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedItems, inputsTick, snapshots]);
}

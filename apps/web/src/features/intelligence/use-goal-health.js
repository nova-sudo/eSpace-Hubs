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
  fetchInputs,
  getInputsState,
  readGoalEntries,
  useAllGoalInputs,
  composedCycleBounds,
  goalStatus,
  GOAL_STATUS,
} from "@/features/goal-inputs";
import { useSnapshots } from "@/features/snapshots";
import {
  isCurrentWindowLocked,
  currentWindowKey,
  legacyCurrentWindowKey,
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
  hydrateManagerVerdicts,
  subscribeManagerVerdicts,
  getManagerVerdictsSnapshot,
  getManagerVerdictsServerSnapshot,
  TIER_ORDER,
} from "@/features/goal-tiers";
import {
  computeTrend,
  deriveGoalHealth,
  HEALTH,
} from "./status";

/**
 * Queue ranking, worst first:
 *   -1  manager requested changes — the goal is blocked on the user
 *    0  graded Not achieved
 *    1  gone quiet / behind target (filled history, owes this window or
 *       missed the number) — ranked after the graded failures
 *    2+ never logged / setup questions unanswered
 * Within a graded band the tier index still orders (not_achieved = 0).
 */
function carouselRank(card) {
  if (card.health?.readiness === GOAL_READINESS.REJECTED) return -1;
  const t = card.tier;
  if (t === "not_achieved") return 0;
  if (card.status?.status === GOAL_STATUS.BEHIND) return 1;
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
  // Manager verdicts outrank the AI tier in readCappedGoalTier — subscribe so
  // the carousel re-ranks the instant a manager grade lands, and hydrate it
  // alongside the AI tiers below.
  const mgrTick = useSyncExternalStore(
    subscribeManagerVerdicts,
    getManagerVerdictsSnapshot,
    getManagerVerdictsServerSnapshot,
  );
  // The Intelligence page can be the first thing loaded (home "/"), with the
  // full board collapsed — so no tier badge mounts to seed the verdict cache.
  // Hydrate it here so the carousel has real tiers on first paint.
  useEffect(() => {
    hydrateGoalTiers();
    hydrateManagerVerdicts();
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
        const cadence = specCadence(spec);
        const lockedCurrentWindow = isCurrentWindowLocked(
          goal.id,
          currentWindowKey(cadence, new Date(), composedCycleBounds(spec)),
          legacyCurrentWindowKey(cadence),
        );
        const lockedKeys = lockedKeysFor(allLocks, goal.id);
        const health = deriveGoalHealth({
          spec,
          entries,
          lockedCurrentWindow,
          contextComplete: isContextComplete(spec),
          lockedKeys,
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
        const verdict = gradeable
          ? readCappedGoalTier(
              goal.id,
              spec,
              entries,
              lockedKeys,
              latestSnapReading(snapshots, goal.id),
            )
          : null;
        const tier = verdict?.tier ?? null;
        // Carry the L1 parent + tier (and the grader's reasoning, so the Focus
        // hero can explain WHY a goal is Not achieved) — rank without
        // re-deriving downstream.
        // The ONE status (shared with Goals, Evidence and the manager
        // board). `health` stays as this page's chore signal — does the
        // CURRENT window still want an entry — but every label, tint and
        // count a person reads comes from `status`.
        const status = goalStatus({
          hasTracker: true,
          ready: health.status !== HEALTH.NEEDS_SETUP,
          auto: health.status === HEALTH.AUTO,
          cycle: health.cycle ?? null,
          hasData: entries.length > 0,
          tier,
          cadence,
        });
        const card = {
          goal,
          spec,
          health,
          status,
          trend,
          l1: group.l1,
          tier,
          tierReasoning: verdict?.reasoning ?? null,
        };
        cards.push(card);

        summary.total += 1;
        if (status.status === GOAL_STATUS.AUTO) summary.auto += 1;
        if (status.status === GOAL_STATUS.ON_PACE || status.status === GOAL_STATUS.EXCEEDING) {
          summary.onPace += 1;
        }
        if (status.status === GOAL_STATUS.NOT_LOGGED) summary.noData += 1;
        if (status.status === GOAL_STATUS.BEHIND) {
          summary.behind += 1;
          if (status.quiet >= 2) summary.stale += 1;
        }
        if (status.status === GOAL_STATUS.NEEDS_SETUP) summary.setup += 1;
        if (trend?.good === true) summary.improving += 1;
        if (trend?.good === false) summary.slipping += 1;

        // Queue = everything the user has to ACT on: graded not_achieved; a
        // goal the manager sent back for changes; a goal that's gone quiet
        // or is behind its target (the summary strip counts these as
        // "behind", so the queue must too — or the page says "2 behind" and
        // "nothing needs you" in the same breath); and goals with no data /
        // unanswered setup questions. Goals at Achieved+ and filled, plus
        // untrackable / delegated / pending-approval ones (waiting on
        // someone else), stay out.
        const actionableSetup =
          health.status === HEALTH.NEEDS_SETUP &&
          (health.readiness === GOAL_READINESS.NEEDS_CONTEXT ||
            health.readiness === GOAL_READINESS.REJECTED);
        // Behind / Not logged by the shared status, or this window still
        // wants its entry (a chore on an otherwise on-pace goal).
        const owesWindow =
          status.status === GOAL_STATUS.BEHIND ||
          status.status === GOAL_STATUS.NOT_LOGGED ||
          health.needsFill === true;
        const ungradedNeedsWork = tier == null && actionableSetup;
        if (tier === "not_achieved" || owesWindow || ungradedNeedsWork) {
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
      return (b.status?.quiet ?? 0) - (a.status?.quiet ?? 0);
    });

    const inputsState = getInputsState();
    return {
      ready: inputsState.fetched,
      // Surfaced so the page can stop spinning when /goal-inputs fails.
      error: inputsState.fetched ? null : inputsState.error,
      retry: fetchInputs,
      groups,
      queue,
      summary,
    };
    // readGoalEntries / getInputsState read live store state; inputsTick
    // changes whenever that state mutates, so it's the correct memo key.
    // snapshots identity changes when the snapshot store updates; locksTick
    // bumps when a window is locked/unlocked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedItems, inputsTick, snapshots, locksTick, contextTick, tiersTick, mgrTick]);
}

"use client";

/**
 * Join the L1/L2 goal tree with the classified spec map and return the
 * array of (goal, spec) pairs the grid wants.
 *
 * Returns BOTH a flat list (for the analyst page's chronological grid)
 * AND a grouped-by-L1 view (for the dashboard's Goal Tracking section,
 * which renders widgets bucketed under their parent L1 heading).
 *
 * Hides the flattening + lookup logic from every page component.
 */

import { useMemo } from "react";
import { useGoals } from "@/features/goals";
import { useGoalSpecs } from "@/features/goal-specs";

function flattenGoals(tree) {
  const out = [];
  for (const l1 of tree?.l1s || []) {
    if (!l1.id) continue;
    out.push({ ...l1, kind: "L1" });
    for (const l2 of l1.l2s || []) {
      if (!l2.id) continue;
      out.push({ ...l2, kind: "L2", parentL1Id: l1.id, parentL1Title: l1.title });
    }
  }
  return out;
}

export function useGoalWidgetItems() {
  const { goals } = useGoals();
  const { specs, lastAnalyzedAt } = useGoalSpecs();

  const items = useMemo(() => {
    const flat = flattenGoals(goals);
    const list = [];
    for (const g of flat) {
      const spec = specs.get(g.id);
      if (!spec) continue;
      list.push({ goal: g, spec });
    }
    return list;
  }, [goals, specs]);

  /**
   * Group classified items under their parent L1. The L1 itself goes
   * first in its bucket (when classified), then its L2s in tree order.
   * L1s with no classified children are dropped from the grouping so
   * the surface stays "what's actually trackable today".
   *
   * Shape: [{ l1: { id, title, category, weightage }, items: [{goal, spec}] }]
   */
  const groupedItems = useMemo(() => {
    if (!goals?.l1s) return [];
    const out = [];
    for (const l1 of goals.l1s) {
      if (!l1.id) continue;
      const bucket = [];
      // The L1 itself, if classified.
      const l1Spec = specs.get(l1.id);
      if (l1Spec) {
        bucket.push({
          goal: { ...l1, kind: "L1" },
          spec: l1Spec,
        });
      }
      // Then each classified L2 child in tree order.
      for (const l2 of l1.l2s || []) {
        if (!l2.id) continue;
        const l2Spec = specs.get(l2.id);
        if (!l2Spec) continue;
        bucket.push({
          goal: {
            ...l2,
            kind: "L2",
            parentL1Id: l1.id,
            parentL1Title: l1.title,
          },
          spec: l2Spec,
        });
      }
      if (bucket.length === 0) continue;
      out.push({
        l1: {
          id: l1.id,
          title: l1.title,
          category: l1.category || null,
          weightage: l1.weightage ?? null,
        },
        items: bucket,
      });
    }
    return out;
  }, [goals, specs]);

  const unclassifiedGoals = useMemo(() => {
    const flat = flattenGoals(goals);
    // L1s are titles/category headers in the eSpace performance-review
    // model — they aren't standalone goals that need classification.
    // The analyst classifies L2s only; the dashboard renders L1s as
    // section headers above their L2 children. Filtering them out
    // here keeps the toolbar's "N goals unclassified" count honest.
    return flat.filter((g) => g.kind !== "L1" && !specs.has(g.id));
  }, [goals, specs]);

  const hasGoals = (goals?.l1s?.length || 0) > 0;

  return {
    items,
    groupedItems,
    unclassifiedGoals,
    hasGoals,
    hasSpecs: items.length > 0,
    lastAnalyzedAt,
  };
}

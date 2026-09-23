/**
 * Pure tree/spec shaping for assigned (shared) goals — no DB, no env, so it
 * unit-tests in isolation. The IO half lives in ./assigned-goals.ts.
 */

import {
  ASSIGNED_ROOT_ID,
  assignedGoalId,
  isAssignedGoalId,
} from "@espace-devhub/shared/goal-specs";
import type { AssignedGoal, GoalL1, GoalL2 } from "../db/types.js";

/** The synthetic L2 an assignee sees for one assigned goal. */
export function syntheticAssignedL2(doc: AssignedGoal): GoalL2 & {
  assigned: { id: string; by: string; byName: string; graceHours: number; timeZone: string };
} {
  const composed = (doc.spec?.composed ?? {}) as Record<string, unknown>;
  return {
    id: assignedGoalId(doc._id.toHexString()),
    code: doc.code,
    title: doc.title,
    description: doc.description,
    rubric: "",
    weightage: 0,
    priority: "",
    startDate: typeof composed.cycleStart === "string" ? composed.cycleStart : "",
    dueDate: typeof composed.cycleEnd === "string" ? composed.cycleEnd : "",
    category: "shared",
    assigned: {
      id: doc._id.toHexString(),
      by: doc.createdBy.toHexString(),
      byName: doc.createdByName,
      graceHours: doc.graceHours,
      timeZone: doc.timeZone || "Africa/Cairo",
    },
  };
}

/** The grouping L1, or null when nothing is assigned. */
export function syntheticAssignedL1(docs: AssignedGoal[]): GoalL1 | null {
  if (docs.length === 0) return null;
  return {
    id: ASSIGNED_ROOT_ID,
    code: "",
    title: "Shared goals",
    description: "Goals a manager shared with you. Fill them here; the plan itself is read-only.",
    rubric: "",
    weightage: 0,
    category: "shared",
    l2s: docs.map(syntheticAssignedL2),
  };
}

/** The spec an assignee's widget renders — the stored spec plus its synthetic goalId. */
export function assignedSpecFor(doc: AssignedGoal): Record<string, unknown> {
  return { ...doc.spec, goalId: assignedGoalId(doc._id.toHexString()) };
}

/** Drop every synthetic node — the safety net on every own-tree write. */
export function stripAssigned<T extends { id?: unknown; l2s?: Array<{ id?: unknown }> }>(
  l1s: T[],
): T[] {
  return (Array.isArray(l1s) ? l1s : [])
    .filter((l1) => !isAssignedGoalId(l1?.id))
    .map((l1) =>
      Array.isArray(l1.l2s)
        ? { ...l1, l2s: l1.l2s.filter((l2) => !isAssignedGoalId(l2?.id)) }
        : l1,
    );
}


/**
 * Manager goal-verdict data access. The durable, authoritative tier a
 * manager sets on a report's goal — outranks the AI cache everywhere a
 * tier is shown.
 *
 * Shared by the manager module (write + board read) and the dev-facing
 * `/goal-verdicts/mine` read, so the "manager wins" precedence has a
 * single source of truth.
 */

import type { ObjectId } from "mongodb";
import { getManagerGoalVerdictsCollection } from "../db/collections.js";
import type { GoalTier, ManagerGoalVerdict } from "../db/types.js";

export interface UpsertManagerVerdictInput {
  orgId: ObjectId;
  subjectUserId: ObjectId;
  goalId: string;
  tier: GoalTier;
  note: string;
  gradedBy: ObjectId;
  gradedByName: string;
}

/** Insert-or-replace the current verdict for (org, subject, goal). */
export async function upsertManagerVerdict(
  input: UpsertManagerVerdictInput,
): Promise<void> {
  const col = await getManagerGoalVerdictsCollection();
  const now = new Date();
  await col.updateOne(
    {
      orgId: input.orgId,
      subjectUserId: input.subjectUserId,
      goalId: input.goalId,
    },
    {
      $set: {
        tier: input.tier,
        note: input.note,
        gradedBy: input.gradedBy,
        gradedByName: input.gradedByName,
        gradedAt: now,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
}

/** All manager verdicts about one subject, keyed by goalId. */
export async function getManagerVerdictMap(
  orgId: ObjectId,
  subjectUserId: ObjectId,
): Promise<Map<string, ManagerGoalVerdict>> {
  const col = await getManagerGoalVerdictsCollection();
  const rows = await col.find({ orgId, subjectUserId }).toArray();
  return new Map(rows.map((r) => [r.goalId, r]));
}

/** All manager verdicts about one subject (for the dev's own hydration). */
export async function listManagerVerdictsForSubject(
  orgId: ObjectId,
  subjectUserId: ObjectId,
): Promise<ManagerGoalVerdict[]> {
  const col = await getManagerGoalVerdictsCollection();
  return col.find({ orgId, subjectUserId }).toArray();
}

"use client";

/**
 * The one write behind every manager grade. PUT
 * /manager/reports/:userId/goals/:goalId/verdict upserts the manager
 * verdict (which outranks the AI tier) and notifies the report.
 *
 * It lives on its own because two surfaces now call it: the grading
 * drawer, where a human picks a rung, and the consistency table's
 * "Accept AI verdict", where agreeing with the AI is recorded as a real
 * verdict instead of being left as a blank row.
 */

import { apiPut } from "@/lib/api-client";

export function saveGoalVerdict({ userId, goalId, tier, note }) {
  return apiPut(
    `/manager/reports/${encodeURIComponent(userId)}/goals/${encodeURIComponent(
      goalId,
    )}/verdict`,
    { tier, note: note ?? "" },
  );
}

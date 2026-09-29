"use client";

/**
 * The one write behind every manager grade. PUT
 * /manager/reports/:userId/goals/:goalId/verdict records the manager
 * verdict (which outranks the AI tier) and notifies the report.
 *
 * It lives on its own because two surfaces now call it: the grading
 * drawer, where a human picks a rung, and the consistency table's
 * "Accept AI verdict", where agreeing with the AI is recorded as a real
 * verdict instead of being left as a blank row.
 */

import { apiPut } from "@/lib/api-client";
import { revalidateManagerData } from "./use-fetch-once";

/**
 * `periodKey` is optional — omitted, the server files the grade under the
 * current calendar year. Grades are append-only: a re-grade supersedes
 * the previous one for that period and the history keeps both.
 */
export async function saveGoalVerdict({ userId, goalId, tier, note, periodKey }) {
  const r = await apiPut(
    `/manager/reports/${encodeURIComponent(userId)}/goals/${encodeURIComponent(
      goalId,
    )}/verdict`,
    { tier, note: note ?? "", ...(periodKey ? { periodKey } : {}) },
  );
  // Grading-progress counts, the queues and this report's reads (history,
  // board) all change with a grade — refresh every mounted reader.
  if (r.ok) void revalidateManagerData(userId);
  return r;
}

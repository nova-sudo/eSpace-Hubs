"use client";

/**
 * "Describe your own tracker" → a COMPOSED widget spec.
 *
 * The classifier can't always find a good widget for a fuzzy goal (e.g. "read
 * 5 chapters every quarter" mis-modelled as a static Q1–Q4 checklist). This is
 * the manual escape hatch: the user describes, in plain English, how they want
 * to track the goal, and the server turns it into a COMPOSED spec (fields +
 * optional cadence + tiers) validated through the shared spec builder.
 *
 * Thin promise-returning helper — same shape as `reclassifyOneGoal`. Reads the
 * active AI provider and POSTs to /api/v1/ai/compose-widget; resolves with the
 * validated spec the caller then saves.
 */

import { getAiProvider } from "./use-ai-provider";

export async function composeWidget({ goalId, goalTitle, description, signal }) {
  if (!goalId) throw new Error("composeWidget: goalId is required");
  const desc = typeof description === "string" ? description.trim() : "";
  if (desc.length < 3) throw new Error("Describe how you want to track this goal.");

  const provider = getAiProvider();
  const res = await fetch("/api/v1/ai/compose-widget", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "x-ai-provider": provider,
    },
    body: JSON.stringify({
      goalId,
      goalTitle: goalTitle || "",
      description: desc,
      provider,
    }),
    signal,
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      body?.error?.message || body?.error || `Couldn't build a tracker (${res.status}).`,
    );
  }
  if (!body?.spec) throw new Error("The AI returned no tracker — try rephrasing.");
  // `seeded: true` means the model's field list was unusable and the server
  // fell back to a generic tracker — surfaced so the UI can hint at it.
  return { spec: body.spec, seeded: body.seeded === true };
}

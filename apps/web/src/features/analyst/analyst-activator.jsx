"use client";

import { Sparkles } from "lucide-react";
import { Button, Badge } from "@/components/ui";
import { useAnalyst, ANALYST_MODES } from "./analyst-provider";
import { useGoalSpecs } from "@/features/goal-specs";
import { useGoals } from "@/features/goals";

/**
 * Header button that opens the analyst page.
 *
 * One name, "AI analyst", with a status suffix (it used to change name
 * between states — review-ux-flows R9):
 *   - no goals yet             → neutral, "AI analyst"
 *   - some goals unclassified  → neutral / lemon, "AI analyst · N to classify"
 *   - goals ≤ specs (all done) → mint, "AI analyst · all set"
 */
export function AnalystActivator() {
  const { requestOpen } = useAnalyst();
  const { goals, total } = useGoals();
  const { count } = useGoalSpecs();

  const totalGoals = (total?.l1s || 0) + (total?.l2s || 0);
  const hasGoals = totalGoals > 0;
  const allClassified = hasGoals && count >= totalGoals;
  const partial = hasGoals && count > 0 && count < totalGoals;
  const dotTone = allClassified ? "mint" : partial ? "lemon" : "neutral";

  const remaining = Math.max(0, totalGoals - count);
  let label = "AI analyst";
  if (allClassified) label = "AI analyst · all set";
  else if (hasGoals) label = `AI analyst · ${remaining} to classify`;

  return (
    <Button
      variant="tint"
      tone="lav"
      size="sm"
      onClick={() =>
        requestOpen(
          allClassified ? ANALYST_MODES.WIDGETS : ANALYST_MODES.ANALYSIS,
        )
      }
      // No aria-label: the accessible name is the visible label (WCAG 2.5.3
      // label-in-name), so voice users can say what they see.
      aria-haspopup="dialog"
    >
      <Sparkles size={14} />
      {label}
      <Badge dot tone={dotTone} />
    </Button>
  );
}

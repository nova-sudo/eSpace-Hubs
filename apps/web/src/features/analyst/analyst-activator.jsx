"use client";

import { Sparkles } from "lucide-react";
import { Button, Badge } from "@/components/ui";
import { useAnalyst, ANALYST_MODES } from "./analyst-provider";
import { useGoalSpecs } from "@/features/goal-specs";
import { useGoals } from "@/features/goals";

/**
 * Header button that opens the analyst page.
 *
 * Status dot:
 *   - no goals yet             → neutral, "AI Analyst"
 *   - goals but no specs       → neutral, "Analyze my goals"
 *   - goals partially analyzed → lemon, "Resume analysis"
 *   - goals ≤ specs (all done) → mint, "Goals analyzed"
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

  let label = "AI Analyst";
  if (allClassified) label = "Goals analyzed";
  else if (partial) label = "Resume analysis";
  else if (hasGoals) label = "Analyze my goals";

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
      aria-label="Open AI Analyst"
    >
      <Sparkles size={14} />
      {label}
      <Badge dot tone={dotTone} />
    </Button>
  );
}

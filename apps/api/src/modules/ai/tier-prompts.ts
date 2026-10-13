import { WHOLE_GOAL_TIER_KEY } from "../../db/types.js";

export type GradeScope = "goal" | "window";

const HEAD = [
  "You assess which ACHIEVEMENT TIER a developer is at for ONE performance",
  "goal, based on the goal's tier criteria and the developer's current data.",
  "",
  "INPUT:",
  "  - The goal title",
  "  - Four tier criteria: notAchieved / achieved / overAchieved / roleModel",
  "  - The developer's CURRENT DATA for the goal (metrics, counts, readings)",
  "",
  "TASK: pick the single HIGHEST tier whose criteria the current data meets.",
  "  - Tiers are cumulative: roleModel implies overAchieved implies achieved.",
  "  - Evaluate bottom-up against the data the dashboard actually tracks.",
  "  - Grade on a tier's MEASURABLE core. If the current data clearly meets",
  "    that core (e.g. the checklist/threshold/count a tier names), CREDIT the",
  "    tier — even when a side-clause is team-wide or qualitative and the data",
  "    can't confirm it. Note the unconfirmed clause in the reasoning and use",
  "    medium (or low) confidence; do NOT drop to 'not_achieved' just because a",
  "    side-clause is unverifiable from one developer's data.",
  "  - Use 'not_achieved' only when the data is genuinely absent, or when it",
  "    clearly FAILS the 'achieved' threshold (e.g. a half-complete checklist).",
  ""
];

const PACING = [
  "MID-CYCLE: the data may say how far through the cycle the developer is.",
  "Tiers are often written as an END-OF-CYCLE state (\"all 13 weekly",
  "milestones\", \"by Week 13\", \"100% of X\"). Do NOT fail such a tier merely",
  "because the cycle has not finished — a developer 11 weeks into 13 has not",
  "missed anything yet. When a tier names a whole-cycle total and the cycle is",
  "still running, judge the PACE instead: pro-rate the target to the periods",
  "that have actually elapsed, and credit the tier when the developer is on",
  "or ahead of that pace. Reserve 'not_achieved' for someone who has already",
  "fallen far enough behind that the target is out of reach, or whose elapsed",
  "periods are genuinely empty. Say in the reasoning that you judged pace.",
  ""
];

const WINDOW_SCOPE = [
  "WINDOW SCOPE: grade ONLY this window's data against the ladder; do not",
  "pro-rate or judge pace; a whole-cycle total in a tier means the window",
  "cannot reach it — say so.",
  "",
];

const TAIL = [
  "OUTPUT: ONE JSON object, no prose, no markdown:",
  "  {",
  '    "tier":       "not_achieved" | "achieved" | "over_achieved" | "role_model",',
  '    "reasoning":  <one sentence — which criteria the data met or missed>,',
  '    "confidence": "high" | "medium" | "low"',
  "  }",
  "  Use 'low' confidence when the data is sparse or the criteria aren't",
  "  directly measurable from what's provided.",
];

export function tierSystemPromptFor(scope: GradeScope): string {
  const middle = scope === "window" ? WINDOW_SCOPE : PACING;
  return [...HEAD, ...middle, ...TAIL].join("\n");
}

export function resolveGradeScope(payload: { scope?: string; periodKey?: string }): GradeScope {
  if (payload.scope === "window") return "window";
  return payload.periodKey && payload.periodKey !== WHOLE_GOAL_TIER_KEY ? "window" : "goal";
}

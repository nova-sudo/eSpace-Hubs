/**
 * glyphMood — map the analyst's live state to a GlyphAgent emotion.
 *
 * Returns one of:
 *   "idle" | "scan" | "think" | "aha" | "working" | "happy" | "concern" | "confused"
 *
 * The analyst exposes a `mode` (from useAnalyst) and a classify `phase` (from
 * useClassifyGoals). When iterating goal-by-goal during analysis, pass the goal
 * currently being classified so the face reacts to its outcome (on-pace →
 * happy, behind → concern, no-data → confused).
 */

export function glyphMood({ mode, phase, activeGoal } = {}) {
  // Reacting to the goal currently being classified takes priority.
  if (activeGoal) {
    if (activeGoal.status === "no-data" || activeGoal.status === "unclassified") return "confused";
    if (activeGoal.status === "behind" || activeGoal.status === "at-risk") return "concern";
    if (activeGoal.status === "on-pace" || activeGoal.status === "done") return "happy";
    if (activeGoal.justFound) return "aha";
  }

  switch (mode) {
    case "analysis":
      if (phase === "reading" || phase === "fetching") return "scan";
      if (phase === "running" || phase === "classifying") return "think";
      if (phase === "building") return "working";
      if (phase === "done") return "happy";
      return "think";
    case "review":
      return "concern";          // awaiting your judgement on flagged specs
    case "chat":
      return "scan";             // attentive / listening
    case "widgets":
    default:
      return "idle";             // resting on the dashboard
  }
}

/**
 * Optional: a small state machine to drive the face imperatively (fire a
 * one-shot "aha" when a goal is matched, then fall back).
 *
 *   const fsm = makeGlyphFSM();
 *   fsm.pulse("aha", 800);               // show aha for 800ms then revert
 *   const mood = fsm.resolve(baseMood);  // call each render
 */
export function makeGlyphFSM() {
  let until = 0, pulsed = null;
  return {
    pulse(emotion, ms = 800) { pulsed = emotion; until = performance.now() + ms; },
    resolve(base) { return performance.now() < until ? pulsed : base; },
  };
}

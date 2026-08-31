"use client";

/**
 * Fill-feedback orchestrator (F9 G1.2 + G1.4) — the bracket the fill
 * call sites (CadenceStepper's "Save & grade", the Counter/Scale/
 * DateLog inline editors) wrap around a commit:
 *
 *   captureBefore()  — a real user gesture is starting a fill
 *   settleAfter()    — the commit landed; after a ~700ms trailing
 *                      debounce, mark FILL INTENT for the goal and poke
 *                      the tiers store so useGoalTier's grading effect
 *                      re-evaluates: qualitative goals force an
 *                      immediate AI re-grade (bypassing the daily
 *                      throttle — G1.3's gate consumes the intent);
 *                      numeric goals re-derive instantly on render with
 *                      no AI call at all.
 *
 * The before→after DIFF deliberately does not live here: useGoalTier's
 * displayed-tier effect (G0.3) is the single recorder, so numeric
 * moves, cap-uncap moves, and post-AI-grade moves all funnel through
 * one R1-safe comparison. This hook's job is intent + pacing:
 *   - a burst of rapid clicks collapses to ONE forced grade (G1.4)
 *   - the intent TTL (transitions store) keeps a stale mark from
 *     force-grading passive drift later
 *   - `feedbackBusy` is true while the debounce window is open, for
 *     "grading…" affordances.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { pokeGoalTiers } from "./goal-tier-store";
import { markFillIntent } from "./tier-transitions-store";

const DEBOUNCE_MS = 700;

export function useTierFillFeedback(goalId) {
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const timerRef = useRef(null);

  const captureBefore = useCallback(() => {
    if (!goalId) return;
    setFeedbackBusy(true);
  }, [goalId]);

  const settleAfter = useCallback(() => {
    if (!goalId) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      markFillIntent(goalId);
      pokeGoalTiers();
      setFeedbackBusy(false);
    }, DEBOUNCE_MS);
  }, [goalId]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { captureBefore, settleAfter, feedbackBusy };
}

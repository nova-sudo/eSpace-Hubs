"use client";

import { GoalsSection } from "./goals-section";
import { GoalTrackingSection } from "./goal-tracking-section";

/**
 * /[hub]/goals — the goals tree + evidence tiles, then the AI-tracked
 * widgets, as two normal page sections. This used to be `GoalsTabPage`
 * inside the retired legacy dashboard, rendered through its scroll-snap
 * shell; moving it here was the last thing blocking that feature's
 * deletion (BL-015, audit #238).
 */
export function GoalsPage() {
  return (
    <main className="relative z-[2]">
      <GoalsSection />
      <GoalTrackingSection />
    </main>
  );
}

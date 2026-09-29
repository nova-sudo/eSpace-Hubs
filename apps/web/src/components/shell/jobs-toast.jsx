"use client";

/**
 * Shell-level driver for the "running jobs" toast.
 *
 * Renders nothing — it subscribes to the in-memory jobs store (which outlives
 * page navigation) and keeps a single persistent sonner toast in sync with
 * whatever background work is running: AI goal analysis and achievement-tier
 * grading. Mounted once in the root layout (a sibling of <Toaster>), so the
 * toast persists and updates no matter which page the user is on.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  subscribeJobs,
  getJobsSnapshot,
  getJobsServerSnapshot,
  getRunningJobs,
} from "@/lib/jobs-store";

const TOAST_ID = "running-jobs";

/** Human summary of the running set, aggregated by kind. */
function describe(jobs) {
  const parts = [];
  if (jobs.some((j) => j.kind === "analysis")) parts.push("Analyzing your goals");
  const grading = jobs.filter((j) => j.kind === "grading").length;
  if (grading > 0) {
    parts.push(`Grading ${grading} goal tier${grading === 1 ? "" : "s"}`);
  }
  const other = jobs.filter(
    (j) => j.kind !== "analysis" && j.kind !== "grading",
  ).length;
  if (other > 0) parts.push(`${other} task${other === 1 ? "" : "s"} running`);
  return parts.join(" · ");
}

export function JobsToast() {
  // Tick subscription — re-runs the derivation whenever a job starts/ends.
  useSyncExternalStore(subscribeJobs, getJobsSnapshot, getJobsServerSnapshot);
  const running = getRunningJobs();
  const summary = describe(running);
  const gradingNow = running.filter((j) => j.kind === "grading").length;
  // Peak grading count for the current batch — so the settle line can say
  // how many goals were graded, not just "done".
  const gradingPeak = useRef(0);
  if (gradingNow > gradingPeak.current) gradingPeak.current = gradingNow;

  useEffect(() => {
    if (!summary) {
      // Settle, don't vanish: a "Grading…" toast that just disappears
      // reads as "nothing happened". Failures get their own toast (with
      // Retry) from the tier store; this line covers the batch.
      const graded = gradingPeak.current;
      gradingPeak.current = 0;
      if (graded > 0) {
        toast.success(`Graded ${graded} goal tier${graded === 1 ? "" : "s"}`, {
          id: TOAST_ID,
          duration: 3500,
          description: "Tier badges are up to date. Any that failed have a Retry above.",
        });
      } else {
        toast.dismiss(TOAST_ID);
      }
      return;
    }
    // Same id → updates the one toast in place as jobs come and go.
    toast.loading(summary, {
      id: TOAST_ID,
      duration: Infinity,
      description: "Running in the background — safe to keep working or switch pages.",
    });
  }, [summary]);

  return null;
}

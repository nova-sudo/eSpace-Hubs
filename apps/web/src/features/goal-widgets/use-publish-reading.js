"use client";

import { useEffect } from "react";
import { publishGoalLiveReading } from "@/features/goal-tiers";

/**
 * The part of a provenance record that is worth carrying, and safe to.
 *
 * `useDataSource` computes provenance for every AUTO metric — how many rows
 * the number is made of, the window it really covers, whether a fetch cap
 * truncated it — and the widget renders it as a chip. It stopped there. The
 * grader saw "18 days median cycle" with no hint that it was a 50-ticket
 * sample with anything resolved over 90 days ago excluded, and graded the
 * number as though it were the whole population.
 *
 * `fetchedAt` and `error` are deliberately dropped. They move on every
 * refetch, and this digest is part of the grader's cache key, so carrying
 * them would re-grade the goal on a timer and churn exactly the way the
 * `hold` option below exists to prevent.
 */
function provenanceDigest(p) {
  if (!p || typeof p !== "object") return undefined;
  const digest = {};
  if (Number.isFinite(p.sample)) digest.sample = p.sample;
  if (typeof p.unit === "string" && p.unit) digest.unit = p.unit;
  if (typeof p.window === "string" && p.window) digest.window = p.window;
  if (p.truncated) digest.truncated = true;
  if (typeof p.note === "string" && p.note.trim()) digest.note = p.note.trim();
  return Object.keys(digest).length > 0 ? digest : undefined;
}

/**
 * Publish a widget's computed headline reading to the shared goal-tiers
 * live-readings store, so surfaces that DON'T mount the widget (the Evidence
 * board / review) can show the exact same value instead of a "tracked on
 * dashboard" placeholder. Mirrors the pattern the SCORECARD widget already
 * uses; the reading is the normalized envelope evidence reads.
 *
 * @param {string} goalId
 * @param {string} widget   the spec.widget kind (guards against a stale reading
 *                          hijacking a reclassified goal — the reader matches on it)
 * @param {{value:string, statusTone:string, statusLabel:string}|null} reading
 *        the display reading, or null once the widget has RESOLVED with no
 *        data (clears the stored reading).
 * @param {{hold?: boolean}} [options]
 *        hold=true means the widget's underlying data is still resolving —
 *        leave the store untouched (neither publish nor clear). This is the
 *        crucial distinction from `reading == null`: a widget backed by a
 *        multi-stage load (e.g. the rubric's PR list THEN verdict-cache
 *        hydration) reads as "0 graded" mid-load, indistinguishable from
 *        "resolved, nothing graded". Clearing on that transient state churns
 *        the tier grader's cache key (grade → re-grade) and flickers the goal
 *        in/out of the Intelligence "needs you" queue. Holding avoids both.
 */
export function usePublishGoalReading(goalId, widget, reading, options) {
  const hold = options?.hold === true;
  // Serialize so the effect only fires on a real value change, not on each
  // render's fresh object identity.
  const json =
    reading && reading.value != null
      ? JSON.stringify({
          widget,
          ...reading,
          provenance: provenanceDigest(reading.provenance),
        })
      : null;
  useEffect(() => {
    // Still resolving — don't touch the store. A previously-published reading
    // survives the load window instead of being cleared and re-published.
    if (!goalId || hold) return;
    // Publish null on the has-data → no-data / needs-scope transition so a
    // stale reading can't linger in the persisted store and drift Evidence
    // away from what the widget now shows. (The SCORECARD widget clears the
    // same way via JSON.stringify(null) → "null" → JSON.parse → null.)
    publishGoalLiveReading(goalId, json == null ? null : JSON.parse(json));
  }, [goalId, json, hold]);
}

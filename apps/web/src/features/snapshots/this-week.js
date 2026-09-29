/**
 * "Is there a snapshot for THIS week?" — one predicate for every surface
 * (the Home nudge and the Evidence checklist used to disagree: Evidence
 * also accepted "captured since Sunday", which the scheduler's Sunday-night
 * freeze of LAST week satisfied — green on Evidence while Home still asked).
 *
 * A snapshot belongs to the week in its `week` key ("W40-2026", lib/date's
 * weekKey), never to the day it happened to be written.
 */

import { weekKey } from "@/lib/date";

export function hasSnapshotThisWeek(snapshots, now = new Date()) {
  const key = weekKey(now);
  return Array.isArray(snapshots) && snapshots.some((s) => s?.week === key);
}

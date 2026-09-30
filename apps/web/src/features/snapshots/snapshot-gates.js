/**
 * Pure gates deciding when the snapshot machinery may spend provider
 * requests. Kept free of React / store imports so they're unit-testable.
 */
import { SPEC_KINDS } from "@espace-devhub/shared/goal-specs";

/**
 * Does a capture need the Jira issue list? Only ticket-cycle trackers read
 * it (`capture-readings.js` → readTicketCycle); everyone else would pay a
 * Jira call for nothing.
 */
export function specsNeedJiraTickets(specs) {
  const list = specs instanceof Map ? [...specs.values()] : Object.values(specs || {});
  return list.some((spec) => spec?.widget === SPEC_KINDS.TICKET_CYCLE);
}

/**
 * Should the weekly auto-snapshot fetch provider data at all? Only once the
 * snapshot history has hydrated from the server AND it holds no snapshot
 * for the most recent completed week — the common case (already captured,
 * or frozen by the API scheduler) costs zero provider requests.
 */
export function autoSnapshotNeeded({ fetched, snapshots, weekLabel }) {
  if (!fetched || !weekLabel) return false;
  return !(Array.isArray(snapshots) && snapshots.some((s) => s?.week === weekLabel));
}

/**
 * Should the backfill fetch its (year-long) provider feeds? Only when the
 * user has actually asked for a run — the banner merely counting missing
 * weeks needs nothing but the snapshot history.
 */
export function backfillFeedsNeeded({ requested }) {
  return Boolean(requested);
}

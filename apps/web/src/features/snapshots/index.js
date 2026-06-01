/**
 * Public API for the snapshots feature.
 *
 * Storage: the snapshot cache is API-direct (`snapshots-store.js`).
 * The in-memory Map hydrates from `GET /api/v1/snapshots` on first
 * mount after sign-in, and POSTs / PATCHes / DELETEs to the API
 * optimistically. There is no longer a localStorage mirror or a
 * `<SnapshotsSync />` lifecycle component — the hook handles
 * hydration itself, gated on the active session.
 */
export { useSnapshots, useSnapshotNow } from "./use-snapshots";
export {
  readSnapshots,
  saveSnapshot,
  updateSnapshotNote,
  clearSnapshots,
  clearAutoSnapshots,
  fetchSnapshots,
  resetSnapshots,
  getSnapshotsState,
  subscribeSnapshots,
  SNAPSHOTS_CHANGE_EVENT,
} from "./snapshots-store";
export { SnapshotsPage } from "./snapshots-page";
export { useAutoSnapshot } from "./use-auto-snapshot";
export { captureGoalReadings } from "./capture-readings";
export { goalCompliance } from "./compliance";
export { useSnapshotCompliance } from "./use-snapshot-compliance";
export { useComplianceSummary } from "./use-compliance-summary";
export { useBackfill } from "./use-backfill";
export { synthesiseWeek } from "./synthesise-week";
export { BackfillBanner } from "./backfill-banner";

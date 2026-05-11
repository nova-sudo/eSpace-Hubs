/**
 * Public API for the one-shot localStorage→API migration.
 *
 * Mount <MigrateOnce /> alongside the other sync components in the
 * root layout. It fires once per device per browser profile after
 * the first authenticated load and is silent on devices with no
 * legacy data.
 */

export { MigrateOnce } from "./migrate-once.jsx";
export {
  readMigrationMarker,
  writeMigrationMarker,
  clearMigrationMarker,
  MIGRATION_MARKER_KEY,
} from "./migrate-store";
export { collectMigrationPayload, MIGRATION_SOURCE_KEYS } from "./collect-payload";

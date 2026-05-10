/**
 * Public API for the goal-specs feature.
 *
 * Kept minimal by design:
 *   - types / enums so widgets can reference `SPEC_KINDS.MERGED_COUNT`
 *   - validator + builder for callers that construct specs
 *   - store CRUD for the AI classifier and admin flows
 *   - hook for React consumers
 *
 * Internal-only modules (change events, raw readers) stay in their files
 * and are not re-exported. Adding something here should be a deliberate
 * API decision.
 */

export {
  ALL_SOURCE_METRICS,
  ALL_SOURCE_PROVIDERS,
  ALL_SPEC_KINDS,
  ALL_SPEC_VARIANTS,
  CONTEXT_QUESTION_KINDS,
  DELEGATED_JUDGES,
  MANUAL_CADENCES,
  SOURCE_METRICS,
  SOURCE_PROVIDERS,
  SOURCE_WINDOWS,
  SPEC_KINDS,
  SPEC_KIND_META,
  SPEC_SCHEMA_VERSION,
  SPEC_VARIANTS,
  TARGET_OPS,
} from "./types";

export { buildSpec, isSpec, validateSpec } from "./schema";

export {
  clearSpecs,
  markAnalyzedAt,
  readSpecs,
  readValidSpecs,
  removeSpec,
  replaceSpecs,
  saveSpec,
  SPECS_CHANGE_EVENT,
  SPECS_STORAGE_KEY,
} from "./specs-store";

export { useGoalSpecs } from "./use-goal-specs";
export { SpecsSync } from "./specs-sync-mount";

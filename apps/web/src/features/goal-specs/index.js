/**
 * Public API for the goal-specs feature.
 *
 * Domain vocabulary + validator come from `@espace-devhub/shared/goal-specs`
 * (single source of truth shared with the API; hoisted in M7.9d).
 * Everything below is web-only: localStorage store, React hook,
 * sync-mount component.
 *
 * Kept minimal by design:
 *   - re-export the shared types / validator so feature consumers can
 *     keep importing from `@/features/goal-specs` without churn
 *   - store CRUD for the AI classifier and admin flows
 *   - hook for React consumers
 *
 * Hydration is driven by the consuming hook (useGoalSpecs) on session
 * establishment — there's no longer a standalone <SpecsSync /> mount.
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
  buildSpec,
  isSpec,
  validateSpec,
} from "@espace-devhub/shared/goal-specs";

export {
  clearSpecs,
  getSpecsState,
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

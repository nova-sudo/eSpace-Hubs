/**
 * Public API for the shared goal-specs domain — constants, normaliser,
 * validator. Consumed by both apps/web and apps/api.
 *
 * Subpath import:
 *   import { SPEC_KINDS, validateSpec } from "@espace-devhub/shared/goal-specs";
 */

export {
  ALL_SOURCE_METRICS,
  ALL_SOURCE_PROVIDERS,
  ALL_SPEC_KINDS,
  ALL_SPEC_VARIANTS,
  COMPOSED_FIELD_KINDS,
  CONTEXT_QUESTION_KINDS,
  DELEGATED_JUDGES,
  MANUAL_CADENCES,
  normalizeCadence,
  SOURCE_METRICS,
  SOURCE_PROVIDERS,
  SOURCE_WINDOWS,
  SPEC_KINDS,
  SPEC_KIND_META,
  SPEC_SCHEMA_VERSION,
  SPEC_VARIANTS,
  specCadence,
  TARGET_OPS,
} from "./types.js";

export { buildSpec, isSpec, validateSpec } from "./validator.js";

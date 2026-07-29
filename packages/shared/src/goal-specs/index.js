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
  isSingleRecordWidget,
  SINGLE_RECORD_WIDGET_KINDS,
  SPEC_KINDS,
  SPEC_KIND_META,
  SPEC_SCHEMA_VERSION,
  SPEC_VARIANTS,
  specCadence,
  resolvePeriodContent,
  TARGET_OPS,
} from "./types.js";

export { buildSpec, isSpec, validateSpec } from "./validator.js";

// Source-backed COMPOSED fields: the allowlisted query registry. Exported from
// the barrel because the composer prompt, the approval UI and the API executor
// all need the SAME list — a second copy of "which queries are allowed" is a
// second thing to forget to tighten.
export {
  buildProviderRequest,
  contextPlaceholderId,
  describeQuerySource,
  extractQueryValue,
  getQueryTemplate,
  isContextPlaceholder,
  isValidQueryParam,
  listQueryTemplates,
  QUERY_EXTRACTS,
  QUERY_PARAM_KINDS,
  QUERY_SOURCE_PROVIDERS,
  QUERY_TEMPLATES,
  QueryTemplateError,
  validateQuerySource,
} from "./query-templates.js";

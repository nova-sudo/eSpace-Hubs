/**
 * Type barrel mirroring index.js for TypeScript consumers.
 */

export {
  SPEC_KINDS,
  ALL_SPEC_KINDS,
  COMPOSED_FIELD_KINDS,
  SOURCE_METRICS,
  ALL_SOURCE_METRICS,
  SPEC_VARIANTS,
  ALL_SPEC_VARIANTS,
  SOURCE_PROVIDERS,
  ALL_SOURCE_PROVIDERS,
  SOURCE_WINDOWS,
  MANUAL_CADENCES,
  normalizeCadence,
  specCadence,
  TARGET_OPS,
  CONTEXT_QUESTION_KINDS,
  DELEGATED_JUDGES,
  SPEC_KIND_META,
  SINGLE_RECORD_WIDGET_KINDS,
  isSingleRecordWidget,
  SPEC_SCHEMA_VERSION,
} from "./types.js";

export type {
  SpecKind,
  ComposedFieldKind,
  SpecField,
  SpecComposed,
  SourceMetric,
  SpecVariant,
  SourceProvider,
  SourceWindow,
  ManualCadence,
  TargetOp,
  ContextQuestionKind,
  DelegatedJudge,
  SpecKindMeta,
  SpecTarget,
  SpecSource,
  SpecManual,
  SpecContextQuestion,
  SpecContext,
  SpecDelegated,
  ValidatedSpec,
} from "./types.js";

export { buildSpec, isSpec, validateSpec } from "./validator.js";
export type { ValidationResult, BuildSpecInput } from "./validator.js";

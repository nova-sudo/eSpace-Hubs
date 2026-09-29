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
  LABEL_MODES,
  MAX_SOURCE_LABELS,
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
  SPEC_NOTE_KINDS,
  SPEC_NOTE_LEVELS,
  DETAIL_MAX_ACTIVITIES,
  DETAIL_MAX_DELIVERABLES,
  NOTES_MAX,
  resolvePeriodContent,
  resolveNestedPeriodContent,
  resolveContentAtPath,
  MANAGEMENT_PATH_SEGMENT,
} from "./types.js";

export type {
  LabelMode,
  SpecKind,
  ComposedFieldKind,
  SpecField,
  SpecComposed,
  SpecComposedPeriod,
  SpecDetail,
  SpecDeliverable,
  SpecNote,
  SpecNoteKind,
  SpecNoteLevel,
  ResolvedPeriodContent,
  WindowPathSegment,
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

export {
  buildSpec,
  COMPOSED_MAX_PERIODS,
  isSpec,
  normalizeSourceLabels,
  validateSpec,
} from "./validator.js";
export {
  CYCLE_MAX_WINDOWS,
  cycleEndForCount,
  snapCycleStart,
  windowCountForCycle,
} from "./cycle.js";
export type { ValidationResult, BuildSpecInput } from "./validator.js";

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
  queryWebLink,
  validateQuerySource,
} from "./query-templates.js";

export type {
  ConcreteQueryProvider,
  NormalizedQuerySource,
  ProviderRequest,
  QueryBuildContext,
  QueryExtract,
  QueryParamKind,
  QuerySource,
  QuerySourceProvider,
  QueryTemplate,
  QueryTemplateSummary,
} from "./query-templates.js";

export {
  buildCycleWindows,
  cadenceConsistency,
  composedCycleBounds,
  currentPeriodKey,
  deriveCycleEndIso,
  enumerateWindows,
  specTrackingStart,
  toIsoDay,
  windowKeyAliases,
} from "./windows.js";

// The Sunday-anchored work week (UTC) — the one week model shared by cadence
// windows, snapshots and the API scheduler.
export {
  sundayOnOrBeforeUtc,
  sunWeekNumberUtc,
  weekKeyUtc,
  weekLabelUtc,
} from "./weeks.js";

/** RECURRING_MILESTONE checklist period key for the period containing `ts`. */
export function recurringPeriodKey(ts: number, cadence: string): string;
/** The key one period before `key`, or null when it can't be stepped. */
export function previousRecurringPeriodKey(key: string, cadence: string): string | null;
export type { CycleWindow } from "./windows.js";

export {
  ASSIGNED_GOAL_PREFIX,
  ASSIGNED_ROOT_ID,
  assignedGoalId,
  isAssignedGoalId,
  parseAssignedGoalId,
} from "./assigned.js";
export {
  assignedWindows,
  localMidnight,
  periodStatuses,
  summarizeStatuses,
} from "./assigned-status.js";
export type {
  AssignedPeriodStatus,
  AssignedWindow,
  AssignedPeriodCell,
  AssignedStatusSummary,
} from "./assigned-status.js";

// The ONE goal status model — every surface (Home, Goals, Evidence, the
// review packet, the manager board) maps its goals through this.
export {
  GOAL_STATUS,
  STATUS_META,
  SEVERITY,
  countStatuses,
  goalStatus,
  isMeasurable,
  loggedSoFar,
  objectiveStatus,
  periodWords,
  quietWindows,
  statusMeta,
  worstStatus,
} from "./goal-status.js";
export type { GoalStatusKey, GoalStatusMeta, GoalStatusResult, LoggedSoFar } from "./goal-status.js";

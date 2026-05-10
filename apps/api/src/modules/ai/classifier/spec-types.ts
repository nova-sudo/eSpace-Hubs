/**
 * Domain vocabulary for classified goal specs.
 *
 * ⚠ DUPLICATED from apps/web/src/features/goal-specs/types.js for M3.2.
 *    M4 (goals + goal-specs collections move) deletes this duplicate
 *    by extracting both copies into packages/shared/. Until then,
 *    keep changes mirrored on both sides.
 *
 * No React, no side-effects — pure constants + one normaliser. Safe to
 * import from anywhere in the API and the frontend bundle.
 */

export const SPEC_KINDS = {
  // Auto
  MERGED_COUNT: "MERGED_COUNT",
  REVIEW_ROUNDS: "REVIEW_ROUNDS",
  TURNAROUND: "TURNAROUND",
  LINKAGE: "LINKAGE",
  TICKET_CYCLE: "TICKET_CYCLE",
  // Hybrid: AI-graded — auto-pull PRs, scored against the user's
  // rubric (captured via spec.context). Lives in the auto row because
  // the user supplies the rubric once; grading is automatic thereafter.
  CODE_RUBRIC: "CODE_RUBRIC",
  // Manual
  COUNTER: "COUNTER",
  SCALE: "SCALE",
  MILESTONE: "MILESTONE",
  DATE_LOG: "DATE_LOG",
  FREE_TEXT: "FREE_TEXT",
  BEFORE_AFTER: "BEFORE_AFTER",
} as const;

export type SpecKind = (typeof SPEC_KINDS)[keyof typeof SPEC_KINDS];
export const ALL_SPEC_KINDS: readonly SpecKind[] = Object.values(SPEC_KINDS);

export const SOURCE_METRICS = {
  MERGED_COUNT: "merged_count",
  AVG_ROUNDS: "avg_rounds",
  MEDIAN_TURNAROUND: "median_turnaround",
  LINKAGE_PCT: "linkage_pct",
  TICKET_CYCLE_TIME: "ticket_cycle_time",
} as const;
export type SourceMetric =
  (typeof SOURCE_METRICS)[keyof typeof SOURCE_METRICS];
export const ALL_SOURCE_METRICS: readonly SourceMetric[] =
  Object.values(SOURCE_METRICS);

export const SPEC_VARIANTS = {
  AUTO: "auto",
  MANUAL: "manual",
  HYBRID: "hybrid",
} as const;
export type SpecVariant =
  (typeof SPEC_VARIANTS)[keyof typeof SPEC_VARIANTS];
export const ALL_SPEC_VARIANTS: readonly SpecVariant[] =
  Object.values(SPEC_VARIANTS);

export const SOURCE_PROVIDERS = {
  GITHUB: "github",
  GITLAB: "gitlab",
  JIRA: "jira",
  COMBINED: "combined",
} as const;
export type SourceProvider =
  (typeof SOURCE_PROVIDERS)[keyof typeof SOURCE_PROVIDERS];
export const ALL_SOURCE_PROVIDERS: readonly SourceProvider[] =
  Object.values(SOURCE_PROVIDERS);

export const SOURCE_WINDOWS = ["30d", "90d", "quarter"] as const;
export type SourceWindow = (typeof SOURCE_WINDOWS)[number];

export const MANUAL_CADENCES = [
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "per-incident",
  "milestone",
  "continuous",
] as const;
export type ManualCadence = (typeof MANUAL_CADENCES)[number];

const CADENCE_SYNONYMS: Record<string, ManualCadence> = {
  // daily
  day: "daily",
  daily: "daily",
  "every-day": "daily",
  "per-day": "daily",
  // weekly
  week: "weekly",
  weekly: "weekly",
  "per-week": "weekly",
  // biweekly
  biweekly: "biweekly",
  "bi-weekly": "biweekly",
  fortnightly: "biweekly",
  "every-two-weeks": "biweekly",
  "every-2-weeks": "biweekly",
  // monthly
  month: "monthly",
  monthly: "monthly",
  "per-month": "monthly",
  // quarterly
  quarter: "quarterly",
  quarterly: "quarterly",
  "per-quarter": "quarterly",
  qtr: "quarterly",
  // per-incident
  "per-incident": "per-incident",
  incident: "per-incident",
  "on-incident": "per-incident",
  "per-event": "per-incident",
  event: "per-incident",
  "as-needed": "per-incident",
  "ad-hoc": "per-incident",
  // milestone
  milestone: "milestone",
  "one-time": "milestone",
  once: "milestone",
  "on-completion": "milestone",
  final: "milestone",
  // continuous
  continuous: "continuous",
  ongoing: "continuous",
  always: "continuous",
  constantly: "continuous",
  realtime: "continuous",
  "real-time": "continuous",
  live: "continuous",
};

/**
 * Coerce any cadence-ish string into a canonical value from
 * `MANUAL_CADENCES`. Returns `null` if the input doesn't map to anything
 * recognised. The classifier uses this to tolerate AI near-misses
 * ("ongoing", "per incident") rather than rejecting whole specs over
 * vocabulary differences.
 */
export function normalizeCadence(raw: unknown): ManualCadence | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, "-");
  return CADENCE_SYNONYMS[key] ?? null;
}

export const TARGET_OPS = ["<=", ">=", "="] as const;
export type TargetOp = (typeof TARGET_OPS)[number];

export const CONTEXT_QUESTION_KINDS = [
  "text",
  "list",
  "number",
  "select",
] as const;
export type ContextQuestionKind = (typeof CONTEXT_QUESTION_KINDS)[number];

export const DELEGATED_JUDGES = ["manager", "senior", "peer"] as const;
export type DelegatedJudge = (typeof DELEGATED_JUDGES)[number];

interface SpecKindMeta {
  label: string;
  variant: SpecVariant;
  /** Auto widgets default to true. CODE_RUBRIC has its own data
   *  pipeline so it sets this to false. */
  requiresSource?: boolean;
  requiresManual?: boolean;
}

export const SPEC_KIND_META: Readonly<Record<SpecKind, SpecKindMeta>> = {
  [SPEC_KINDS.MERGED_COUNT]: { label: "Merged count", variant: SPEC_VARIANTS.AUTO },
  [SPEC_KINDS.REVIEW_ROUNDS]: {
    label: "Review rounds",
    variant: SPEC_VARIANTS.AUTO,
  },
  [SPEC_KINDS.TURNAROUND]: { label: "Turnaround", variant: SPEC_VARIANTS.AUTO },
  [SPEC_KINDS.LINKAGE]: { label: "Linkage", variant: SPEC_VARIANTS.AUTO },
  [SPEC_KINDS.TICKET_CYCLE]: {
    label: "Ticket cycle",
    variant: SPEC_VARIANTS.AUTO,
  },
  [SPEC_KINDS.CODE_RUBRIC]: {
    label: "Rubric grading",
    variant: SPEC_VARIANTS.AUTO,
    requiresSource: false,
  },
  [SPEC_KINDS.COUNTER]: { label: "Counter", variant: SPEC_VARIANTS.MANUAL },
  [SPEC_KINDS.SCALE]: { label: "1–5 scale", variant: SPEC_VARIANTS.MANUAL },
  [SPEC_KINDS.MILESTONE]: {
    label: "Milestone checklist",
    variant: SPEC_VARIANTS.MANUAL,
  },
  [SPEC_KINDS.DATE_LOG]: { label: "Date log", variant: SPEC_VARIANTS.MANUAL },
  [SPEC_KINDS.FREE_TEXT]: { label: "Journal", variant: SPEC_VARIANTS.MANUAL },
  [SPEC_KINDS.BEFORE_AFTER]: {
    label: "Before / after",
    variant: SPEC_VARIANTS.MANUAL,
  },
};

export const SPEC_SCHEMA_VERSION = 1;

// ─── result types ────────────────────────────────────────────────────

export interface SpecTarget {
  op: TargetOp;
  value: number;
  period?: string;
}

export interface SpecSource {
  provider: SourceProvider;
  metric: SourceMetric;
  window: SourceWindow;
  filter?: { label?: string; branch?: string; ticketType?: string };
  target?: SpecTarget;
}

export interface SpecManual {
  prompt: string;
  cadence: ManualCadence;
  unit?: string;
  items?: string[];
  target?: SpecTarget;
}

export interface SpecContextQuestion {
  id: string;
  prompt: string;
  kind: ContextQuestionKind;
  placeholder?: string;
  options?: string[];
}

export interface SpecContext {
  required: boolean;
  questions: SpecContextQuestion[];
}

export interface SpecDelegated {
  delegated: boolean;
  judge?: DelegatedJudge;
  note?: string;
}

export interface ValidatedSpec {
  schemaVersion: number;
  goalId: string;
  kind: SpecVariant;
  widget: SpecKind;
  title: string;
  reasoning: string;
  source: SpecSource | null;
  manual: SpecManual | null;
  context: SpecContext | null;
  delegated: SpecDelegated | null;
  classifiedAt: number;
}

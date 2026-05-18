/**
 * Type declarations for the goal-specs domain vocabulary.
 *
 * Mirrors types.js: the .js file owns the runtime constants and the
 * normaliser; this .d.ts gives the API (TypeScript) the literal types
 * and shape declarations. Web (JavaScript) consumes types.js directly.
 */

export const SPEC_KINDS: Readonly<{
  readonly MERGED_COUNT: "MERGED_COUNT";
  readonly REVIEW_ROUNDS: "REVIEW_ROUNDS";
  readonly TURNAROUND: "TURNAROUND";
  readonly LINKAGE: "LINKAGE";
  readonly TICKET_CYCLE: "TICKET_CYCLE";
  readonly CODE_RUBRIC: "CODE_RUBRIC";
  readonly COUNTER: "COUNTER";
  readonly SCALE: "SCALE";
  readonly MILESTONE: "MILESTONE";
  readonly DATE_LOG: "DATE_LOG";
  readonly FREE_TEXT: "FREE_TEXT";
  readonly BEFORE_AFTER: "BEFORE_AFTER";
}>;

export type SpecKind = (typeof SPEC_KINDS)[keyof typeof SPEC_KINDS];
export const ALL_SPEC_KINDS: readonly SpecKind[];

export const SOURCE_METRICS: Readonly<{
  readonly MERGED_COUNT: "merged_count";
  readonly AVG_ROUNDS: "avg_rounds";
  readonly MEDIAN_TURNAROUND: "median_turnaround";
  readonly LINKAGE_PCT: "linkage_pct";
  readonly TICKET_CYCLE_TIME: "ticket_cycle_time";
}>;
export type SourceMetric =
  (typeof SOURCE_METRICS)[keyof typeof SOURCE_METRICS];
export const ALL_SOURCE_METRICS: readonly SourceMetric[];

export const SPEC_VARIANTS: Readonly<{
  readonly AUTO: "auto";
  readonly MANUAL: "manual";
  readonly HYBRID: "hybrid";
}>;
export type SpecVariant =
  (typeof SPEC_VARIANTS)[keyof typeof SPEC_VARIANTS];
export const ALL_SPEC_VARIANTS: readonly SpecVariant[];

export const SOURCE_PROVIDERS: Readonly<{
  readonly GITHUB: "github";
  readonly GITLAB: "gitlab";
  readonly JIRA: "jira";
  readonly COMBINED: "combined";
}>;
export type SourceProvider =
  (typeof SOURCE_PROVIDERS)[keyof typeof SOURCE_PROVIDERS];
export const ALL_SOURCE_PROVIDERS: readonly SourceProvider[];

export const SOURCE_WINDOWS: readonly ["30d", "90d", "quarter"];
export type SourceWindow = (typeof SOURCE_WINDOWS)[number];

export const MANUAL_CADENCES: readonly [
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "per-incident",
  "milestone",
  "continuous",
];
export type ManualCadence = (typeof MANUAL_CADENCES)[number];

export function normalizeCadence(raw: unknown): ManualCadence | null;

export const TARGET_OPS: readonly ["<=", ">=", "="];
export type TargetOp = (typeof TARGET_OPS)[number];

export const CONTEXT_QUESTION_KINDS: readonly [
  "text",
  "list",
  "number",
  "select",
];
export type ContextQuestionKind = (typeof CONTEXT_QUESTION_KINDS)[number];

export const DELEGATED_JUDGES: readonly ["manager", "senior", "peer"];
export type DelegatedJudge = (typeof DELEGATED_JUDGES)[number];

export interface SpecKindMeta {
  label: string;
  variant: SpecVariant;
  requiresSource?: boolean;
  requiresManual?: boolean;
}
export const SPEC_KIND_META: Readonly<Record<SpecKind, SpecKindMeta>>;

export const SPEC_SCHEMA_VERSION: 1;

// ─── result shapes ───────────────────────────────────────────────────

export interface SpecTarget {
  op: TargetOp;
  value: number;
  period?: string;
}

export interface SpecSource {
  provider: SourceProvider;
  metric: SourceMetric;
  window: SourceWindow;
  filter?: {
    label?: string;
    branch?: string;
    ticketType?: string;
    /**
     * GitHub/GitLab repo slug ("owner/name" or "group/project").
     * When set, the metrics layer filters merged-MR results to only
     * this repo before computing counts/medians.
     */
    repo?: string;
  };
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

export interface SpecUntrackable {
  reason: string;
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
  untrackable: SpecUntrackable | null;
  classifiedAt: number;
}

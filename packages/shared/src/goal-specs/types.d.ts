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
  readonly FIRST_PASS_RATE: "FIRST_PASS_RATE";
  readonly DEPLOY_FREQUENCY: "DEPLOY_FREQUENCY";
  readonly LEAD_TIME: "LEAD_TIME";
  readonly BUILD_PASS_RATE: "BUILD_PASS_RATE";
  readonly CODE_RUBRIC: "CODE_RUBRIC";
  readonly COUNTER: "COUNTER";
  readonly SCALE: "SCALE";
  readonly MILESTONE: "MILESTONE";
  readonly DATE_LOG: "DATE_LOG";
  readonly FREE_TEXT: "FREE_TEXT";
  readonly BEFORE_AFTER: "BEFORE_AFTER";
  readonly INCIDENT_LOG: "INCIDENT_LOG";
  readonly RECURRING_MILESTONE: "RECURRING_MILESTONE";
  readonly SCORECARD: "SCORECARD";
  readonly COMPOSED: "COMPOSED";
}>;

export type SpecKind = (typeof SPEC_KINDS)[keyof typeof SPEC_KINDS];
export const ALL_SPEC_KINDS: readonly SpecKind[];

export const COMPOSED_FIELD_KINDS: readonly [
  "checkbox",
  "counter",
  "scale",
  "number",
  "text",
  "date",
  "select",
  "link",
];
export type ComposedFieldKind = (typeof COMPOSED_FIELD_KINDS)[number];

export const SOURCE_METRICS: Readonly<{
  readonly MERGED_COUNT: "merged_count";
  readonly AVG_ROUNDS: "avg_rounds";
  readonly MEDIAN_TURNAROUND: "median_turnaround";
  readonly LINKAGE_PCT: "linkage_pct";
  readonly TICKET_CYCLE_TIME: "ticket_cycle_time";
  readonly FIRST_PASS_RATE: "first_pass_rate";
  readonly DEPLOY_FREQUENCY: "deploy_frequency";
  readonly LEAD_TIME: "lead_time";
  readonly BUILD_PASS_RATE: "build_pass_rate";
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
  readonly JENKINS: "jenkins";
  readonly GITHUB_ACTIONS: "github_actions";
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
     * this repo before computing counts/medians. Reused by the
     * GitHub Actions provider to scope `/actions/runs` to one repo.
     */
    repo?: string;
    /**
     * Jenkins job name. Required for AUTO widgets whose
     * `source.provider === "jenkins"` — Jenkins doesn't expose a
     * cross-job feed, so each spec scopes to ONE job slug.
     */
    job?: string;
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

/**
 * Phase G: the four achievement-level criteria an AI grader scores the
 * goal against. The classifier distils these from the goal's freeform
 * `rubric`, aligned to the widget's metric where one exists. Each is a
 * short, ideally measurable criterion; any can be null when a tier
 * wasn't expressible.
 */
export interface SpecTiers {
  notAchieved: string | null;
  achieved: string | null;
  overAchieved: string | null;
  roleModel: string | null;
}

/**
 * One sub-spec inside a SCORECARD spec.
 *
 * Carries the same `widget`+`kind`+`source`+`manual` shape as a
 * top-level spec but without the metadata fields (goalId, title,
 * reasoning, context, delegated, untrackable, classifiedAt) — those
 * live on the parent. The `weight` is a positive number; the
 * aggregate function normalises by the sum of weights, so absolute
 * scale doesn't matter (50/50 and 1/1 give the same result), but
 * 0–100 is the convention.
 */
export interface SpecScorecardComponent {
  label?: string;
  weight: number;
  widget: SpecKind;
  kind: SpecVariant;
  source: SpecSource | null;
  manual: SpecManual | null;
}

export type ScorecardAggregate = "weighted";

export interface SpecScorecard {
  components: SpecScorecardComponent[];
  aggregate: ScorecardAggregate;
}

/**
 * One declarative field of a COMPOSED (generative) widget. The classifier
 * invents the combination from the bounded `ComposedFieldKind` vocabulary, so
 * the generated widget is always renderable AND gradeable. `options` is
 * required for `kind: "select"`; `target` is an optional numeric bar for
 * counter/number fields.
 */
export interface SpecField {
  id: string;
  kind: ComposedFieldKind;
  label: string;
  unit?: string;
  help?: string;
  optional?: boolean;
  options?: string[];
  target?: { op: TargetOp; value: number };
}

/** The cadence + prompt frame around a COMPOSED widget's fields. */
export interface SpecComposed {
  cadence?: ManualCadence;
  prompt?: string;
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
  /** Phase E: only set when widget === "SCORECARD". */
  scorecard: SpecScorecard | null;
  /** Generative widget: the field schema + cadence/prompt frame. Only set
   *  when widget === "COMPOSED" (null otherwise). */
  fields?: SpecField[] | null;
  composed?: SpecComposed | null;
  /**
   * Phase G: AI-gradeable achievement tiers distilled from the goal's
   * rubric. null when the goal has no gradeable tiers.
   */
  tiers: SpecTiers | null;
  classifiedAt: number;
}

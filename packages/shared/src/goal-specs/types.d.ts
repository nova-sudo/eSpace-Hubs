/**
 * Type declarations for the goal-specs domain vocabulary.
 *
 * Mirrors types.js: the .js file owns the runtime constants and the
 * normaliser; this .d.ts gives the API (TypeScript) the literal types
 * and shape declarations. Web (JavaScript) consumes types.js directly.
 */

import type { QuerySource } from "./query-templates.js";

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

/** The cadence a spec buckets on — `manual.cadence`, else `composed.cadence`. */
export function specCadence(spec: unknown): ManualCadence | null;

export const TARGET_OPS: readonly ["<=", ">=", "="];
export type TargetOp = (typeof TARGET_OPS)[number];

export const CONTEXT_QUESTION_KINDS: readonly [
  "text",
  "list",
  "number",
  "select",
  // Drifted from types.js until source-backed fields needed it: the composer
  // asks for a repo with a resource_link question, and TypeScript callers were
  // being told that kind didn't exist.
  "resource_link",
  // One or more "owner/name" slugs picked from the user's connected
  // providers. Answer is a string array; repo-parameterised sources fan
  // out across every selected repo (see query-runner).
  "repo_select",
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

/** Widget kinds whose editor keeps one latest-wins record, not per-period entries. */
export const SINGLE_RECORD_WIDGET_KINDS: ReadonlySet<SpecKind>;
export function isSingleRecordWidget(widget: unknown): boolean;

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
  /**
   * Where this field's value comes from, when the tools already know it — an
   * allowlisted GitHub/GitLab query rather than something the user retypes
   * every week. A field WITH a source is read-only in the UI; a field without
   * one is unchanged, which is why every COMPOSED spec written before this
   * existed still validates and renders identically.
   *
   * The shape is owned by ./query-templates: the AI may only name a template
   * id and fill declared params, never a URL. See that file for why.
   */
  source?: QuerySource;
}

/**
 * One authored period of a COMPOSED widget — an ORDERED annotation of the
 * cycle window at the same index.
 *
 * Positional, not keyed to a calendar string: periods line up 1:1 with the
 * windows the goal's cadence already produces, so per-period content inherits
 * the existing compliance / owed-state / stepper machinery rather than adding a
 * second notion of "which period is this". `key` is stable authoring identity
 * only — never the storage key.
 *
 * Everything but `label` is optional; whatever a period omits falls back to the
 * widget-level `fields` / `composed.prompt`.
 */
export interface SpecComposedPeriod {
  key: string;
  label: string;
  /** ISO YYYY-MM-DD. Drives overdue/upcoming styling, never bucketing. */
  dueAt?: string;
  prompt?: string;
  fields?: SpecField[];
  /**
   * A whole second cadence living INSIDE this one window (a quarter
   * containing weeks, each with their own form). Recursive — `nested` can
   * itself carry periods whose own periods nest again, gated only by a safety
   * depth ceiling (COMPOSED_MAX_NEST_DEPTH in the validator, not a product
   * limit). Absent means this window has no sub-cadence, which is every
   * pre-existing COMPOSED spec.
   */
  nested?: SpecComposed;
}

/** The cadence + prompt frame around a COMPOSED widget's fields. */
export interface SpecComposed {
  cadence?: ManualCadence;
  prompt?: string;
  /**
   * Per-period content, for plans whose every period asks for something
   * DIFFERENT (a 13-week rollout where week 3 wants a project constitution and
   * week 8 a refined spec template). Absent = the flat, uniform tracker that
   * every pre-existing COMPOSED spec describes. Requires `cadence`.
   */
  periods?: SpecComposedPeriod[];
  /**
   * The cycle's real calendar bounds (ISO YYYY-MM-DD), paired — a plan that
   * doesn't run Jan–Dec (a 13-week plan starting in September). Absent means
   * `buildCycleWindows` keeps defaulting to the calendar year of "now", which
   * is only correct for a goal that actually starts January 1.
   */
  cycleStart?: string;
  cycleEnd?: string;
  /**
   * Default fields for THIS cadence level's periods when a period doesn't
   * specify its own — the nested-level equivalent of top-level `spec.fields`.
   * Only meaningful (and only ever stored) on a NESTED block; the top-level
   * `composed` ignores this in favour of `spec.fields`, which already plays
   * the identical role there.
   */
  fields?: SpecField[];
}

/** What `resolvePeriodContent`/`resolveNestedPeriodContent` resolve a window to. */
export interface ResolvedPeriodContent {
  label: string | null;
  prompt: string | null;
  dueAt: string | null;
  fields: SpecField[];
  /** True when an authored period actually covered this window. */
  authored: boolean;
  /** The window's nested sub-cadence, if it authored one — see SpecComposedPeriod.nested. */
  nested: SpecComposed | null;
}

/**
 * Resolve what a given cycle window should ask for: the authored period at
 * `windowIndex` merged over the widget-level defaults. Returns the flat spec
 * content unchanged when the spec has no `composed.periods`.
 */
export function resolvePeriodContent(
  spec: unknown,
  windowIndex: number,
): ResolvedPeriodContent;

/**
 * Same resolution as `resolvePeriodContent`, but starting from a NESTED
 * `composed` block (`period.nested`) rather than a full spec — used to
 * recurse into however many levels a spec actually authors.
 */
export function resolveNestedPeriodContent(
  nestedComposed: unknown,
  windowIndex: number,
): ResolvedPeriodContent;

export interface SpecApproval {
  status: "pending" | "approved" | "rejected";
  submittedAt?: number;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: number;
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
  /** P4: manager-approval gate for COMPOSED "Build Your Own" trackers. */
  approval?: SpecApproval | null;
  classifiedAt: number;
}

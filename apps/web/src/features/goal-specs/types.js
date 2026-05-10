/**
 * Domain vocabulary for classified goal specs.
 *
 * Kept in its own file (no React, no side-effects) so both the domain layer
 * (schema validation) and the widget registry can depend on these constants
 * without creating circular imports.
 *
 * Adding a new widget → add a constant to `SPEC_KINDS`, a matching case to
 * `SPEC_KIND_META`, and register a widget component in
 * `features/goal-widgets/widgets/_register.jsx`. No other touch points.
 */

/**
 * Canonical widget identifiers. The classifier emits one of these as
 * `spec.widget`; the widget registry maps them to React components.
 *
 * Groups:
 *   AUTO    — derived purely from integration data (no user input).
 *   MANUAL  — captured from the user (time series stored in goal-inputs).
 *   HYBRID  — "auto + manual" spec pairs get rendered side-by-side; see
 *             the `kind: "hybrid"` spec variant. Hybrid specs still pick a
 *             single `widget` constant but the WIDGET renders a two-pane
 *             layout using the embedded `source` + `manual` fields.
 */
export const SPEC_KINDS = Object.freeze({
  // Auto
  MERGED_COUNT: "MERGED_COUNT",
  REVIEW_ROUNDS: "REVIEW_ROUNDS",
  TURNAROUND: "TURNAROUND",
  LINKAGE: "LINKAGE",
  TICKET_CYCLE: "TICKET_CYCLE",
  // Hybrid: AI-graded widgets — auto-pull PRs, but scored against user's
  // rubric (captured via spec.context). Lives in the auto row because the
  // user doesn't manually enter each data point; they supply the rubric
  // once, grading is automatic thereafter.
  CODE_RUBRIC: "CODE_RUBRIC",
  // Manual
  COUNTER: "COUNTER",
  SCALE: "SCALE",
  MILESTONE: "MILESTONE",
  DATE_LOG: "DATE_LOG",
  FREE_TEXT: "FREE_TEXT",
  BEFORE_AFTER: "BEFORE_AFTER",
});

/** Convenience list for iterating over all widget kinds. */
export const ALL_SPEC_KINDS = Object.freeze(Object.values(SPEC_KINDS));

/**
 * Metric identifiers the AUTO widgets can be backed by. Each maps through
 * `use-data-source.js` to an integration hook + a pure metric function.
 *
 * Kept independent of `SPEC_KINDS` so a single widget (e.g. a generic
 * "trend" widget) could read multiple metrics in the future without
 * renaming the enum.
 */
export const SOURCE_METRICS = Object.freeze({
  MERGED_COUNT: "merged_count",
  AVG_ROUNDS: "avg_rounds",
  MEDIAN_TURNAROUND: "median_turnaround",
  LINKAGE_PCT: "linkage_pct",
  TICKET_CYCLE_TIME: "ticket_cycle_time",
});

export const ALL_SOURCE_METRICS = Object.freeze(Object.values(SOURCE_METRICS));

/** The three "shapes" a spec can take. */
export const SPEC_VARIANTS = Object.freeze({
  AUTO: "auto",
  MANUAL: "manual",
  HYBRID: "hybrid",
});

export const ALL_SPEC_VARIANTS = Object.freeze(Object.values(SPEC_VARIANTS));

/** Supported providers for an auto-source. */
export const SOURCE_PROVIDERS = Object.freeze({
  GITHUB: "github",
  GITLAB: "gitlab",
  JIRA: "jira",
  COMBINED: "combined",
});

export const ALL_SOURCE_PROVIDERS = Object.freeze(Object.values(SOURCE_PROVIDERS));

/** Time window presets a source can use. */
export const SOURCE_WINDOWS = Object.freeze(["30d", "90d", "quarter"]);

/**
 * Cadence presets for manual entry.
 *
 * Kept deliberately small + canonical. If the AI emits a near-miss
 * (e.g. "quarterly", "per incident", "ongoing"), `normalizeCadence()`
 * below maps it to one of these canonical values rather than rejecting
 * the whole spec — classification is expensive, the output is noisy,
 * and the user should never see a validation failure for something that
 * was semantically fine.
 */
export const MANUAL_CADENCES = Object.freeze([
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "per-incident",
  "milestone",
  "continuous",
]);

/**
 * Synonyms → canonical cadence. Keys are lower-cased, trimmed, and have
 * whitespace replaced with hyphens; `normalizeCadence` does the same
 * normalization on its input before lookup.
 *
 * Adding a new synonym: drop it into this map. No other touch points.
 */
const CADENCE_SYNONYMS = Object.freeze({
  // daily
  "day": "daily",
  "daily": "daily",
  "every-day": "daily",
  "per-day": "daily",
  // weekly
  "week": "weekly",
  "weekly": "weekly",
  "per-week": "weekly",
  // biweekly
  "biweekly": "biweekly",
  "bi-weekly": "biweekly",
  "fortnightly": "biweekly",
  "every-two-weeks": "biweekly",
  "every-2-weeks": "biweekly",
  // monthly
  "month": "monthly",
  "monthly": "monthly",
  "per-month": "monthly",
  // quarterly
  "quarter": "quarterly",
  "quarterly": "quarterly",
  "per-quarter": "quarterly",
  "qtr": "quarterly",
  // per-incident
  "per-incident": "per-incident",
  "incident": "per-incident",
  "on-incident": "per-incident",
  "per-event": "per-incident",
  "event": "per-incident",
  "as-needed": "per-incident",
  "ad-hoc": "per-incident",
  // milestone
  "milestone": "milestone",
  "one-time": "milestone",
  "once": "milestone",
  "on-completion": "milestone",
  "final": "milestone",
  // continuous
  "continuous": "continuous",
  "ongoing": "continuous",
  "always": "continuous",
  "constantly": "continuous",
  "realtime": "continuous",
  "real-time": "continuous",
  "live": "continuous",
});

/**
 * Coerce any cadence-ish string into a canonical value from `MANUAL_CADENCES`.
 * Returns `null` if the input doesn't map to anything recognized.
 */
export function normalizeCadence(raw) {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, "-");
  return CADENCE_SYNONYMS[key] ?? null;
}

/** Comparison operators used in target objects. */
export const TARGET_OPS = Object.freeze(["<=", ">=", "="]);

/**
 * Kinds of context question the AI can ask the user before tracking begins.
 * Kept small and stable — widgets render inputs based on this enum.
 */
export const CONTEXT_QUESTION_KINDS = Object.freeze([
  "text",    // free-text single-line
  "list",    // comma-or-newline-separated items → string[]
  "number",  // numeric input
  "select",  // one-of a given `options` array
]);

/**
 * Who judges a delegated goal. Used purely for display today; later can
 * drive reminders ("nudge your manager for a check-in").
 */
export const DELEGATED_JUDGES = Object.freeze([
  "manager",
  "senior",
  "peer",
]);

/**
 * Human-facing labels + the default variant each widget belongs to.
 * Consumed by the analysis-stream UI to render "Classified as …" chips
 * without the widget registry needing to be loaded.
 */
/**
 * Per-widget metadata used by validators + UI chrome.
 *
 * Fields:
 *   label         — human-readable name shown in the analysis stream.
 *   variant       — which lane the widget belongs in (auto/manual).
 *   requiresSource — set to `false` for widgets that declare `kind:"auto"`
 *                    but use their own data pipeline (not `useDataSource`).
 *                    Example: CODE_RUBRIC fetches PRs + grades them via its
 *                    own hook. Default when absent is `true` for AUTO.
 *   requiresManual — analogous for manual widgets; default true for MANUAL.
 */
export const SPEC_KIND_META = Object.freeze({
  [SPEC_KINDS.MERGED_COUNT]: { label: "Merged count", variant: SPEC_VARIANTS.AUTO },
  [SPEC_KINDS.REVIEW_ROUNDS]: { label: "Review rounds", variant: SPEC_VARIANTS.AUTO },
  [SPEC_KINDS.TURNAROUND]: { label: "Turnaround", variant: SPEC_VARIANTS.AUTO },
  [SPEC_KINDS.LINKAGE]: { label: "Linkage", variant: SPEC_VARIANTS.AUTO },
  [SPEC_KINDS.TICKET_CYCLE]: { label: "Ticket cycle", variant: SPEC_VARIANTS.AUTO },
  [SPEC_KINDS.CODE_RUBRIC]: {
    label: "Rubric grading",
    variant: SPEC_VARIANTS.AUTO,
    // CODE_RUBRIC has its own data pipeline (via `useGradedPrs`) and reads
    // its rubric from `spec.context.answers`, so the generic source block
    // doesn't apply. The validator skips the "auto-needs-source" check.
    requiresSource: false,
  },
  [SPEC_KINDS.COUNTER]: { label: "Counter", variant: SPEC_VARIANTS.MANUAL },
  [SPEC_KINDS.SCALE]: { label: "1–5 scale", variant: SPEC_VARIANTS.MANUAL },
  [SPEC_KINDS.MILESTONE]: { label: "Milestone checklist", variant: SPEC_VARIANTS.MANUAL },
  [SPEC_KINDS.DATE_LOG]: { label: "Date log", variant: SPEC_VARIANTS.MANUAL },
  [SPEC_KINDS.FREE_TEXT]: { label: "Journal", variant: SPEC_VARIANTS.MANUAL },
  [SPEC_KINDS.BEFORE_AFTER]: { label: "Before / after", variant: SPEC_VARIANTS.MANUAL },
});

/** Current schema version persisted in each spec. Bump when shape changes. */
export const SPEC_SCHEMA_VERSION = 1;

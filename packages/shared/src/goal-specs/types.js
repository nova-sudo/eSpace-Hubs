/**
 * Domain vocabulary for classified goal specs — single source of truth.
 *
 * Lives in @espace-devhub/shared because both the web frontend (JS) and
 * the API (TS) classifier need the same constants and the cadence
 * normaliser. Previously duplicated as
 *   apps/web/src/features/goal-specs/types.js
 *   apps/api/src/modules/ai/classifier/spec-types.ts
 * and the two drifted whenever one side added a synonym. M7.9d hoists
 * the source up here and re-exports from the original homes for
 * backward-compatible imports.
 *
 * No React, no Node-only APIs — safe in any environment.
 */

export const SPEC_KINDS = Object.freeze({
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
  // Phase D1: incident-stream + period-reset milestone. Both are
  // pure-manual widgets that piggy-back on the goal-inputs store —
  // INCIDENT_LOG appends one entry per incident (with severity +
  // downtime minutes + optional post-mortem link); RECURRING_MILESTONE
  // appends a fresh checklist snapshot per cadence period and tracks
  // streak-of-complete-periods.
  INCIDENT_LOG: "INCIDENT_LOG",
  RECURRING_MILESTONE: "RECURRING_MILESTONE",
});

export const ALL_SPEC_KINDS = Object.freeze(Object.values(SPEC_KINDS));

export const SOURCE_METRICS = Object.freeze({
  MERGED_COUNT: "merged_count",
  AVG_ROUNDS: "avg_rounds",
  MEDIAN_TURNAROUND: "median_turnaround",
  LINKAGE_PCT: "linkage_pct",
  TICKET_CYCLE_TIME: "ticket_cycle_time",
});

export const ALL_SOURCE_METRICS = Object.freeze(Object.values(SOURCE_METRICS));

export const SPEC_VARIANTS = Object.freeze({
  AUTO: "auto",
  MANUAL: "manual",
  HYBRID: "hybrid",
});

export const ALL_SPEC_VARIANTS = Object.freeze(Object.values(SPEC_VARIANTS));

export const SOURCE_PROVIDERS = Object.freeze({
  GITHUB: "github",
  GITLAB: "gitlab",
  JIRA: "jira",
  COMBINED: "combined",
});

export const ALL_SOURCE_PROVIDERS = Object.freeze(Object.values(SOURCE_PROVIDERS));

export const SOURCE_WINDOWS = Object.freeze(["30d", "90d", "quarter"]);

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
 * Synonyms → canonical cadence. Keys are lower-cased, trimmed, and
 * whitespace-replaced-with-hyphens; normalizeCadence does the same
 * normalisation on its input before lookup.
 *
 * Adding a new synonym: one entry here. No other touch points.
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
 * Coerce any cadence-ish string into a canonical value from
 * MANUAL_CADENCES. Returns null if the input doesn't map to anything
 * recognised. Lets the classifier tolerate AI near-misses ("ongoing",
 * "per incident") rather than rejecting whole specs over vocab drift.
 */
export function normalizeCadence(raw) {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, "-");
  return CADENCE_SYNONYMS[key] ?? null;
}

export const TARGET_OPS = Object.freeze(["<=", ">=", "="]);

export const CONTEXT_QUESTION_KINDS = Object.freeze([
  "text",
  "list",
  "number",
  "select",
]);

export const DELEGATED_JUDGES = Object.freeze(["manager", "senior", "peer"]);

/**
 * Per-widget metadata used by validators and UI chrome.
 *
 * Fields:
 *   label          — human-readable name shown in the analysis stream.
 *   variant        — which lane the widget belongs in (auto/manual).
 *   requiresSource — set to false for widgets that declare kind:"auto"
 *                    but use their own data pipeline (not useDataSource).
 *                    Example: CODE_RUBRIC fetches PRs + grades them.
 *                    Default when absent is true for AUTO.
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
    requiresSource: false,
  },
  [SPEC_KINDS.COUNTER]: { label: "Counter", variant: SPEC_VARIANTS.MANUAL },
  [SPEC_KINDS.SCALE]: { label: "1–5 scale", variant: SPEC_VARIANTS.MANUAL },
  [SPEC_KINDS.MILESTONE]: { label: "Milestone checklist", variant: SPEC_VARIANTS.MANUAL },
  [SPEC_KINDS.DATE_LOG]: { label: "Date log", variant: SPEC_VARIANTS.MANUAL },
  [SPEC_KINDS.FREE_TEXT]: { label: "Journal", variant: SPEC_VARIANTS.MANUAL },
  [SPEC_KINDS.BEFORE_AFTER]: { label: "Before / after", variant: SPEC_VARIANTS.MANUAL },
  [SPEC_KINDS.INCIDENT_LOG]: { label: "Incident log", variant: SPEC_VARIANTS.MANUAL },
  [SPEC_KINDS.RECURRING_MILESTONE]: {
    label: "Recurring milestone",
    variant: SPEC_VARIANTS.MANUAL,
  },
});

export const SPEC_SCHEMA_VERSION = 1;

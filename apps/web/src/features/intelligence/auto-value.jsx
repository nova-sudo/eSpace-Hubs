"use client";

/**
 * Live value + target for an AUTO goal on the hub card.
 *
 * Replaces the opaque "computed from your activity" line with the actual
 * number the integration produced and how it stacks against target — e.g.
 * "12 merged · target ≥ 10 ✓". Reuses goal-widgets' `useDataSource`, the
 * same resolver the dashboard tiles + check-in read-outs use, so there's
 * one source of truth for the metric math.
 *
 * Graceful by design: AUTO kinds without a `spec.source` (CODE_RUBRIC,
 * SCORECARD) and metrics we haven't mapped a headline for yet (the CI/CD
 * trio) fall back to the generic note rather than rendering a wrong number.
 */

import { useDataSource } from "@/features/goal-widgets";
import { SOURCE_METRICS } from "@/features/goal-specs";

// metric → how to pull the single headline scalar out of useDataSource's
// per-metric `data` shape, plus its unit. Lower-is-better metrics are
// flagged so the target check knows which direction "good" runs.
const METRIC_HEADLINE = {
  [SOURCE_METRICS.MERGED_COUNT]: (d) => ({ value: d?.count, unit: "merged" }),
  [SOURCE_METRICS.AVG_ROUNDS]: (d) => ({
    value: d?.value == null ? null : round1(d.value),
    unit: "rounds",
  }),
  [SOURCE_METRICS.MEDIAN_TURNAROUND]: (d) => ({
    value: d?.median == null ? null : Math.round(d.median * 24),
    unit: "h",
  }),
  [SOURCE_METRICS.LINKAGE_PCT]: (d) => ({ value: d?.pct, unit: "%" }),
  [SOURCE_METRICS.FIRST_PASS_RATE]: (d) => ({ value: d?.pct, unit: "%" }),
  [SOURCE_METRICS.TICKET_CYCLE_TIME]: (d) => ({
    value: d?.median == null ? null : round1(d.median),
    unit: "d",
  }),
};

export function AutoGoalValue({ spec }) {
  const source = spec?.source || null;
  // Hook must run every render — useDataSource short-circuits to
  // { data: null } when source/metric is missing, so calling it with a
  // null source is safe.
  const { data, isLoading } = useDataSource(source);

  const mapper = source?.metric ? METRIC_HEADLINE[source.metric] : null;
  if (!mapper) return <GenericNote />;

  if (isLoading) {
    return (
      <div
        className="text-[10px] uppercase tracking-[0.4px] text-muted-fg/60"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        reading your activity…
      </div>
    );
  }

  const { value, unit } = mapper(data);
  if (value == null || Number.isNaN(Number(value))) return <GenericNote />;

  const target = source.target || null;
  const met = evalMet(Number(value), target);

  return (
    <div className="flex items-center gap-2">
      <span
        className="rounded-md border px-2 py-0.5"
        style={{
          fontFamily: "var(--font-mono)",
          borderColor:
            met === true
              ? "color-mix(in srgb, var(--good) 40%, transparent)"
              : met === false
                ? "color-mix(in srgb, #d97706 40%, transparent)"
                : "var(--border)",
        }}
      >
        <span className="text-[13px] font-semibold text-fg">{value}</span>
        <span className="ml-1 text-[10px] text-muted-fg">{unit}</span>
      </span>
      {target ? (
        <span
          className="text-[10px] uppercase tracking-[0.4px] text-muted-fg/70"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          target {target.op} {target.value}
          {met === true ? " ✓" : met === false ? " ✕" : ""}
        </span>
      ) : (
        <span
          className="text-[10px] uppercase tracking-[0.4px] text-muted-fg/60"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          auto-tracked
        </span>
      )}
    </div>
  );
}

function GenericNote() {
  return (
    <div
      className="text-[10px] uppercase tracking-[0.4px] text-muted-fg/70"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      Computed from your activity · no manual entry needed
    </div>
  );
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

/** True/false/null (null = no target or non-numeric). Mirrors the editors'. */
function evalMet(value, target) {
  if (!target || target.value == null || !Number.isFinite(value)) return null;
  if (target.op === ">=") return value >= target.value;
  if (target.op === "<=") return value <= target.value;
  if (target.op === "=") {
    return Math.abs(value - target.value) < 0.01 * Math.abs(target.value || 1);
  }
  return null;
}

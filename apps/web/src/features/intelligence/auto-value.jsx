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

import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui";
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

/**
 * @param {{ spec: object, compact?: boolean }} props
 *        `compact` renders the bare value for a dense row (the objective
 *        bands' value column) — no target clause, no fallback prose, just a
 *        dash when there's nothing to show.
 */
export function AutoGoalValue({ spec, compact = false }) {
  const source = spec?.source || null;
  // Hook must run every render — useDataSource short-circuits to
  // { data: null } when source/metric is missing, so calling it with a
  // null source is safe.
  const { data, isLoading } = useDataSource(source);

  const mapper = source?.metric ? METRIC_HEADLINE[source.metric] : null;
  if (!mapper) return compact ? <Dash /> : <GenericNote />;

  if (isLoading) {
    return compact ? <Dash /> : <div className="text-[12px] text-muted-fg">Reading your activity…</div>;
  }

  const { value, unit } = mapper(data);
  if (value == null || Number.isNaN(Number(value))) return compact ? <Dash /> : <GenericNote />;

  if (compact) {
    // Only symbol-ish units survive the narrow column; a word ("merged")
    // goes to the tooltip so the number itself never truncates.
    const short = unit && unit.length <= 2 ? `${value}${unit}` : String(value);
    return <span title={`${value} ${unit}`.trim()}>{short}</span>;
  }

  const target = source.target || null;
  const met = evalMet(Number(value), target);

  return (
    <div className="flex items-center gap-2">
      <span className="rounded-[var(--radius-md)] bg-card-alt px-2.5 py-1">
        <span className="text-[15px] font-bold text-fg">{value}</span>
        <span className="ml-1 text-[12px] text-muted-fg">{unit}</span>
      </span>
      {target ? (
        <span className="flex items-center gap-1.5 text-[12px] text-muted-fg">
          target {target.op} {target.value}
          {met != null ? (
            <Badge tone={met ? "mint" : "peach"}>{met ? <Check size={11} /> : <X size={11} />}</Badge>
          ) : null}
        </span>
      ) : (
        <span className="text-[12px] text-muted-fg">Auto-tracked</span>
      )}
    </div>
  );
}

function Dash() {
  return <span className="text-dim-fg">—</span>;
}

function GenericNote() {
  return <div className="text-[12px] text-muted-fg">Computed from your activity · no manual entry needed</div>;
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

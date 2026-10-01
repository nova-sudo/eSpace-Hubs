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

import { useSyncExternalStore } from "react";
import { opLabel } from "@/lib/fmt";
import { Check, X } from "lucide-react";
import { Badge, LiveValue } from "@/components/ui";
import { useDataSource, useSourceLiveStatus } from "@/features/goal-widgets";
import {
  getGoalLiveReadingsServerSnapshot,
  getGoalLiveReadingsSnapshot,
  readGoalLiveReading,
  subscribeGoalLiveReadings,
} from "@/features/goal-tiers";
import { SOURCE_METRICS } from "@/features/goal-specs";

// metric → how to pull the single headline scalar out of useDataSource's
// per-metric `data` shape, plus its unit. Lower-is-better metrics are
// flagged so the target check knows which direction "good" runs.
const METRIC_HEADLINE = {
  // A zero count is "No merges yet" (the empty state), same as the Goals tile.
  [SOURCE_METRICS.MERGED_COUNT]: (d) => ({ value: d?.count ? d.count : null, unit: "merged" }),
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
 * The live headline scalar for an AUTO spec — the one number the hub card,
 * the objective bands and the focus hero all show.
 *
 * Never blanks a number the user already saw: when the provider feed has
 * nothing yet (cold load, refresh failed, rate limited) it falls back to the
 * widget's last PUBLISHED reading (goal-tiers live-readings store, persisted),
 * and `status` says how fresh the value is for `<LiveValue>`.
 *
 * @param {object|null} spec  pass null for a non-AUTO goal; the hook still
 *        runs (hook order) but short-circuits.
 * @returns {{ supported: boolean, isLoading: boolean, value: number|null,
 *             unit: string, target: object|null, lastKnown: boolean,
 *             status: object }}
 *        `supported` is false when the metric has no mapped headline.
 *        `isLoading` is true only when there is nothing at all to show.
 */
export function useAutoHeadline(spec) {
  const source = spec?.source || null;
  // Hook must run every render — useDataSource short-circuits to
  // { data: null } when source/metric is missing, so calling it with a
  // null source is safe.
  const ds = useDataSource(source);
  const mapper = source?.metric ? METRIC_HEADLINE[source.metric] : null;
  useSyncExternalStore(
    subscribeGoalLiveReadings,
    getGoalLiveReadingsSnapshot,
    getGoalLiveReadingsServerSnapshot,
  );

  let value = null;
  let unit = "";
  let lastKnown = false;
  if (mapper) {
    const live = mapper(ds.data);
    unit = live.unit || "";
    if (live.value != null && !Number.isNaN(Number(live.value))) {
      value = live.value;
    } else {
      // Last-known: the score the Goals tile published for this goal. The
      // mapper reads its own field, so hand it the score under every name.
      const stored = spec?.goalId ? readGoalLiveReading(spec.goalId) : null;
      if (stored && stored.widget === spec.widget && Number.isFinite(stored.score)) {
        const s = stored.score;
        const fb = mapper({ count: s, value: s, median: s, pct: s });
        if (fb.value != null && !Number.isNaN(Number(fb.value))) {
          value = fb.value;
          lastKnown = true;
        }
      }
    }
  }
  const status = useSourceLiveStatus(mapper ? source : null, ds, {
    hasValue: value != null,
    emptyLabel: source?.metric === SOURCE_METRICS.MERGED_COUNT ? "No merges yet this year" : undefined,
  });
  if (!mapper) {
    return { supported: false, isLoading: false, value: null, unit: "", target: null, lastKnown: false, status };
  }
  return {
    supported: true,
    isLoading: value == null && status.pending,
    value,
    unit,
    target: source.target || null,
    lastKnown,
    status,
  };
}

/**
 * @param {{ spec: object, compact?: boolean }} props
 *        `compact` renders the bare value for a dense row (the objective
 *        bands' value column) — no target clause, the freshness note folded
 *        into a status dot + tooltip.
 */
export function AutoGoalValue({ spec, compact = false }) {
  const { supported, value, unit, target, status } = useAutoHeadline(spec);
  if (!supported) return compact ? <Dash /> : <GenericNote />;

  if (compact) {
    // Only symbol-ish units survive the narrow column; a word ("merged")
    // goes to the tooltip so the number itself never truncates.
    const short = value == null ? "" : unit && unit.length <= 2 ? `${value}${unit}` : String(value);
    return (
      <LiveValue
        status={{ ...status, emptyLabel: "None yet" }}
        layout="compact"
        skeleton="w-[3ch]"
        messageClassName="text-[12px]"
      >
        <span title={`${value} ${unit}`.trim()}>{short}</span>
      </LiveValue>
    );
  }

  const met = value == null ? null : evalMet(Number(value), target);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <LiveValue status={status} layout="inline" skeleton="w-[4ch]" className="text-[15px]">
        <span className="rounded-[var(--radius-md)] bg-card-alt px-2.5 py-1">
          <span className="text-[15px] font-bold text-fg">{value}</span>
          <span className="ml-1 text-[12px] text-muted-fg">{unit}</span>
        </span>
      </LiveValue>
      {target ? (
        <span className="flex items-center gap-1.5 text-[12px] text-muted-fg">
          target {opLabel(target.op)} {target.value}
          {met != null ? (
            <Badge tone={met ? "mint" : "peach"}>{met ? <Check size={11} /> : <X size={11} />}</Badge>
          ) : null}
        </span>
      ) : value != null ? (
        <span className="text-[12px] text-muted-fg">Auto-tracked</span>
      ) : null}
    </div>
  );
}

function Dash() {
  return <span className="text-muted-fg">—</span>;
}

function GenericNote() {
  return <div className="text-[12px] text-muted-fg">Computed from your activity · no manual entry needed</div>;
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

/** True/false/null (null = no target or non-numeric). Mirrors the editors'. */
export function evalMet(value, target) {
  if (!target || target.value == null || !Number.isFinite(value)) return null;
  if (target.op === ">=") return value >= target.value;
  if (target.op === "<=") return value <= target.value;
  if (target.op === "=") {
    return Math.abs(value - target.value) < 0.01 * Math.abs(target.value || 1);
  }
  return null;
}
